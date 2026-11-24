/**
 * Phase 1 preview (read-only: partner MCP reads + Claude policy calls, no chain).
 *
 *   pnpm --filter @oracle-markets/curator preview
 *
 * Gathers the candidate pool, pre-selects 2×N per category without the Claude
 * check, classifies those (if ANTHROPIC_API_KEY is set), then prints the final
 * top N per category and every skip reason. Report → partner-mcp-samples/preview.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { connectPartner } from "../src/partner-feed";
import { gatherPool } from "../src/pool";
import { classifyAll } from "../src/policy";
import { loadConfig, selectTop, type Selection } from "../src/select";

const OUT = new URL("./partner-mcp-samples/", import.meta.url).pathname;

function print(sel: Selection, checked: boolean) {
  for (const [cat, list] of Object.entries(sel.byCategory)) {
    console.log(`\n${cat} (${list.length})`);
    for (const s of list) {
      const q = s.question;
      const tr = q.trendingRank ? ` trending #${q.trendingRank}` : "";
      console.log(
        `  ${Math.round((q.p ?? 0) * 100)}%  ${q.closeAt?.toISOString().slice(0, 10)}  score ${s.score.toFixed(2)}${tr}  ${s.title}`,
      );
    }
  }
  const reasons = new Map<string, number>();
  for (const s of sel.skipped) {
    const key = s.reason.replace(/\d+(\.\d+)?/g, "#");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  console.log(`\nSkipped ${sel.skipped.length}:`);
  for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${r}`);
  if (!checked) console.log("\n(ANTHROPIC_API_KEY not set: Claude policy check NOT run.)");
}

async function main() {
  const cfg = loadConfig();
  const { client } = await connectPartner();
  const pool = await gatherPool(client, cfg, {
    maxCalls: Number(process.env.CURATOR_MAX_MCP_CALLS ?? 500),
    minIntervalMs: Number(process.env.PARTNER_MCP_MIN_INTERVAL_MS ?? 500),
    log: (m) => console.log(m),
  });
  await client.close();
  console.log(`${pool.questions.length} questions fetched in ${pool.calls} MCP calls`);
  const pre = selectTop(pool.questions, { ...cfg, topN: cfg.topN * 2 });
  const checked = Boolean(process.env.ANTHROPIC_API_KEY);
  const verdicts = checked
    ? await classifyAll(
        new Anthropic(),
        pre.selected.map((s) => s.question),
      )
    : undefined;
  const sel = selectTop(pool.questions, cfg, { verdicts, requireVerdict: checked });
  print(sel, checked);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    `${OUT}preview.json`,
    JSON.stringify(
      { at: new Date(), calls: pool.calls, errors: pool.errors, checked, ...sel },
      null,
      2,
    ),
  );
  console.log(
    `\nReport: ${OUT}preview.json${pool.errors.length ? ` (${pool.errors.length} errors)` : ""}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
