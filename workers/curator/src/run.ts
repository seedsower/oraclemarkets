/**
 * One curator run: partner pool → selection (Phase 1) → market creation (Phase 2).
 *
 *   pnpm --filter @oracle-markets/curator once        (CURATOR_DRY_RUN=true by default)
 *
 * A real run (CURATOR_DRY_RUN=false) needs REDIS_URL, CURATOR_KEYPAIR and
 * ANTHROPIC_API_KEY (content policy + short titles are mandatory then). The
 * process exits when done (Railway cron requires it).
 */
import Anthropic from "@anthropic-ai/sdk";
import IORedis from "ioredis";
import { connectPartner, KvOAuthProvider } from "./partner-feed";
import { gatherPool, type Pool } from "./pool";
import { classifyAll, type MessagesClient } from "./policy";
import { loadConfig, selectTop, type CuratorConfig, type Selection, type Verdict } from "./select";
import { shortTitle } from "./short-title";
import { pickTitle } from "./title";
import { K } from "./keys";
import { loadCreateConfig, planFor, roundRobin, type CreateConfig } from "./plan";
import { createOne, reconcile, type Deps, type Kv } from "./create";
import { balances, loadChainConfig, loadKeypair, makeCuratorClient } from "./chain";
import {
  acquireLock,
  allowance,
  loadBudgetConfig,
  openSeed,
  releaseLock,
  type Allowance,
} from "./budget";
import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { PmAmmClient } from "@pm-amm/sdk";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { refreshCurated, type LifecycleKv, type Lookup } from "./lifecycle";
import { fromPrediction } from "./question";

const log = (m: string) => console.log(m);

/** Short titles (cached in Redis) and policy verdicts for the pre-selected 2×N. */
async function vet(pool: Pool, cfg: CuratorConfig, kv: Kv | null, claude: MessagesClient | null) {
  const shortTitles = new Map(Object.entries(kv ? await kv.hgetall(K.titles) : {}));
  const pre = selectTop(
    pool.questions,
    { ...cfg, topN: cfg.topN * 2 },
    { deferTitle: true, shortTitles },
  );
  const verdicts = new Map<string, Verdict>();
  if (!claude) return { shortTitles, verdicts: undefined };
  const toCheck = [];
  for (const { question: q } of pre.selected) {
    if (kv && (await kv.get(K.link(q.id)))) {
      verdicts.set(q.id, { ok: true, reason: "already curated" });
      continue;
    }
    if (!pickTitle([shortTitles.get(q.id), q.text])) {
      const t = await shortTitle(claude, q);
      if (!t) continue; // stays "no title fits"
      shortTitles.set(q.id, t);
      await kv?.hset(K.titles, q.id, t);
    }
    toCheck.push(q);
  }
  for (const [id, v] of await classifyAll(claude, toCheck)) verdicts.set(id, v);
  log(`vetted ${toCheck.length} questions with Claude`);
  return { shortTitles, verdicts };
}

export interface RunRow {
  questionId: string;
  category: string;
  name: string;
  result: string;
  market?: string;
  priceBps?: number;
  signature?: string;
}

/** Create (or, in a dry run, list) the selected markets, round-robin across categories. */
async function create(
  sel: Selection,
  c: CreateConfig,
  kv: Kv | null,
  deps: Deps | null,
  budget: Allowance,
) {
  const rows: RunRow[] = [];
  let made = 0;
  for (const s of roundRobin(sel.byCategory)) {
    const base = { questionId: s.question.id, category: s.question.category, name: s.title };
    const linked = kv ? await kv.get(K.link(s.question.id)) : null;
    if (linked) {
      rows.push({ ...base, result: "already linked", market: linked });
      continue;
    }
    if (made >= budget.allowed) {
      rows.push({ ...base, result: `over budget (${budget.limitedBy})` });
      continue;
    }
    const plan = planFor(s, c);
    if ("skip" in plan) {
      rows.push({ ...base, result: `skipped: ${plan.skip}` });
      continue;
    }
    if (c.dryRun || !deps) {
      made++;
      rows.push({ ...base, result: "would create", priceBps: plan.priceBps });
      continue;
    }
    const out = await createOne(deps, plan);
    if (out.status === "created") made++;
    rows.push({
      ...base,
      result: out.status === "failed" ? `failed: ${out.error}` : out.status,
      market: "market" in out ? out.market : undefined,
      priceBps: plan.priceBps,
      signature: out.status === "created" ? out.signature : undefined,
    });
  }
  return rows;
}

function report(rows: RunRow[], sel: Selection, c: CreateConfig, pool: Pool) {
  log(`\n${c.dryRun ? "DRY RUN — nothing sent" : "LIVE RUN"} · seed ${c.seedUsdc} USDC each`);
  for (const r of rows) {
    const price = r.priceBps ? `${(r.priceBps / 100).toFixed(0)}%` : "";
    log(
      `  [${r.category}] ${r.result.padEnd(14)} ${price.padStart(4)}  ${r.name}${r.market ? `  ${r.market}` : ""}`,
    );
  }
  const counts = rows.reduce<Record<string, number>>(
    (a, r) => ((a[r.result] = (a[r.result] ?? 0) + 1), a),
    {},
  );
  log(
    `\n${JSON.stringify(counts)} · ${sel.skipped.length} skipped by selection · ${pool.calls} MCP calls`,
  );
}

async function main() {
  const cfg = loadConfig();
  const c = loadCreateConfig();
  const kp = loadKeypair();
  const kv = process.env.REDIS_URL
    ? new IORedis(process.env.REDIS_URL, { family: 0, maxRetriesPerRequest: 2 })
    : null;
  const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  if (!c.dryRun && (!kv || !kp || !claude))
    throw new Error("a live run needs REDIS_URL, CURATOR_KEYPAIR and ANTHROPIC_API_KEY");
  if (!kv) log("(no REDIS_URL: existing links not checked)");
  if (!claude) log("(no ANTHROPIC_API_KEY: content policy and short titles not checked)");
  // A client whenever there's a key: dry runs read balances too; only live runs send.
  const client = kp ? await makeCuratorClient(loadChainConfig(), kp) : null;
  const deps: Deps | null = !c.dryRun && client && kv ? { kv, chain: client } : null;
  const token = randomUUID();
  if (kv && !(await acquireLock(kv, token))) {
    log("another curator run holds curator:lock — exiting");
    kv.disconnect();
    return;
  }
  try {
    await runLocked(cfg, c, kv, claude, client, deps);
  } finally {
    if (kv) {
      await releaseLock(kv, token).catch(() => {});
      kv.disconnect();
    }
  }
}

/** Budget for this run, from balances and open curated markets (no wallet → per-run cap only). */
async function budgetFor(c: CreateConfig, kv: IORedis | null, client: PmAmmClient | null) {
  const b = loadBudgetConfig();
  if (!client) {
    const allowed = c.maxNewPerRun;
    return { allowed, limitedBy: "CURATOR_MAX_NEW_PER_RUN", limits: {} } as Allowance;
  }
  const chainCfg = loadChainConfig();
  const [bal, open] = await Promise.all([
    balances(client.connection, client.walletPubkey(), chainCfg.collateralMint),
    kv ? openSeed(kv, client, (s) => new PublicKey(s), c.seedUsdc) : Promise.resolve(0),
  ]);
  const a = allowance(
    { maxNewPerRun: c.maxNewPerRun, seedUsdc: c.seedUsdc, openSeedUsdc: open, ...bal },
    b,
  );
  log(
    `budget: ${bal.usdc} USDC, ${bal.sol.toFixed(3)} SOL, ${open} USDC open in curated markets ` +
      `(cap ${b.maxOpenSeedUsdc}) → up to ${a.allowed} new (limited by ${a.limitedBy})`,
  );
  return a;
}

async function runLocked(
  cfg: CuratorConfig,
  c: CreateConfig,
  kv: IORedis | null,
  claude: MessagesClient | null,
  client: PmAmmClient | null,
  deps: Deps | null,
) {
  if (deps) log(`reconcile: ${JSON.stringify(await reconcile(deps))}`);
  const budget = await budgetFor(c, kv, client);
  const partner = await connectPartner(kv ? new KvOAuthProvider(kv) : undefined);
  const pool = await gatherPool(partner.client, cfg, {
    maxCalls: Number(process.env.CURATOR_MAX_MCP_CALLS ?? 500),
    minIntervalMs: Number(process.env.PARTNER_MCP_MIN_INTERVAL_MS ?? 500),
    log,
  });
  const { shortTitles, verdicts } = await vet(pool, cfg, kv, claude);
  const sel = selectTop(pool.questions, cfg, { shortTitles, verdicts, requireVerdict: !!claude });
  const rows = await create(sel, c, kv, deps, budget);
  report(rows, sel, c, pool);
  const callsLeft = Number(process.env.CURATOR_MAX_MCP_CALLS ?? 500) - pool.calls;
  await lifecycle(c, kv, client, partner.client, sel, pool, callsLeft);
  await partner.client.close();
}

/** Reads pass through; writes are skipped (a dry run reports what would change). */
function dryKv(kv: IORedis): LifecycleKv {
  const skip = async () => 0;
  return {
    hkeys: (k) => kv.hkeys(k),
    get: (k) => kv.get(k),
    set: skip,
    hset: skip,
    hsetnx: skip,
    hdel: skip,
    sadd: skip,
    srem: skip,
  };
}

/** Phase 4 pass over every curated market (see lifecycle.ts). */
async function lifecycle(
  c: CreateConfig,
  kv: IORedis | null,
  client: PmAmmClient | null,
  partner: Client,
  sel: Selection,
  pool: Pool,
  callsLeft: number,
) {
  if (!kv || !client) return log("lifecycle: skipped (needs REDIS_URL and CURATOR_KEYPAIR)");
  let left = callsLeft;
  const interval = Number(process.env.PARTNER_MCP_MIN_INTERVAL_MS ?? 500);
  const lookup = async (id: string): Promise<Lookup | null> => {
    if (left-- <= 0) return null;
    await new Promise((r) => setTimeout(r, interval));
    try {
      const res = (await partner.callTool({
        name: "get_prediction",
        arguments: { question_id: id },
      })) as {
        isError?: boolean;
        content?: { type: string; text?: string }[];
      };
      if (res.isError)
        return {
          question: null,
          error: res.content?.find((x) => x.type === "text")?.text ?? "error",
        };
      return { question: fromPrediction(res) };
    } catch {
      return null;
    }
  };
  const r = await refreshCurated(
    {
      kv: c.dryRun ? dryKv(kv) : kv,
      fetchMarket: (pk) => client.fetchMarket(pk),
      toKey: (s) => new PublicKey(s),
      lookup,
    },
    new Set(sel.selected.map((s) => s.question.id)),
    new Map(pool.questions.map((q) => [q.id, q])),
  );
  log(
    `lifecycle${c.dryRun ? " (dry run: no writes)" : ""}: ${r.refreshed} AI lines refreshed, ` +
      `${r.featured} featured, ${r.unfeatured} unfeatured, ${r.resolved} resolved on-chain, ${r.review.length} for review`,
  );
  for (const i of r.review) log(`  review ${i.market}: ${i.note} ${i.url}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
