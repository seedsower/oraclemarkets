/**
 * Phase 0 discovery against oraclemarkets.io's MCP server (read-only).
 *
 *   pnpm --filter @oracle-markets/curator discover      (sign in first: `login`)
 *
 * 1. tools/list → every tool's name, description, inputSchema, outputSchema.
 * 2. For each of the 12 categories, tries the read-like tools (search / list /
 *    get) with whatever category / query / limit / sort arguments their schemas
 *    expose.
 * 3. Calls the get-by-id tool on two results per category.
 * Raw responses go to scripts/partner-mcp-samples/.
 *
 * NEVER calls a tool that could write or publish (ask_question creates a public
 * question and uses the daily quota): see isReadOnly().
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { connectPartner } from "../src/partner-feed";

export const CATEGORIES = [
  "Politics",
  "Finance",
  "Economics",
  "Geopolitics",
  "Culture",
  "Business",
  "Sports",
  "Climate",
  "Technology",
  "Science",
  "Crypto",
  "Other",
];
const OUT = join(__dirname, "partner-mcp-samples/");
const WRITE_WORDS =
  /\b(ask|create|add|publish|submit|post|delete|remove|update|edit|set|watch|subscribe|vote)\b/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MIN_INTERVAL = Number(process.env.PARTNER_MCP_MIN_INTERVAL_MS ?? 500);
let calls = 0;

/** Only tools whose name AND description read as lookups. */
export function isReadOnly(t: Pick<Tool, "name" | "description">): boolean {
  const name = t.name.replace(/[_-]/g, " ");
  if (WRITE_WORDS.test(name)) return false;
  if (!/\b(search|list|get|find|fetch|read|browse|query|top|trending|categor)/i.test(name))
    return false;
  return !/\b(creates?|publish(es)?|submits?|adds? to|posts?)\b/i.test(t.description ?? "");
}

const props = (t: Tool) =>
  (t.inputSchema?.properties ?? {}) as Record<string, { enum?: unknown[]; type?: string }>;

/** Argument sets to try for one category, built from the tool's input schema. */
export function argSets(t: Tool, category: string): Record<string, unknown>[] {
  const p = props(t);
  const base: Record<string, unknown> = {};
  const catKey = Object.keys(p).find((k) => /categor|topic|tag/i.test(k));
  if (catKey)
    base[catKey] =
      p[catKey]!.enum?.find((v) => String(v).toLowerCase() === category.toLowerCase()) ?? category;
  for (const k of Object.keys(p))
    if (/^(limit|max|count|per_?page|page_?size)$/i.test(k)) base[k] = 20;
  for (const k of Object.keys(p))
    if (/^(status|state)$/i.test(k))
      base[k] = p[k]!.enum?.find((v) => /active|open/i.test(String(v))) ?? "active";
  const queryKey = Object.keys(p).find((k) => /^(q|query|search|text|term)$/i.test(k));
  const sets = [base];
  if (queryKey)
    sets.push({ ...base, [queryKey]: catKey ? "" : category }, { ...base, [queryKey]: "*" });
  const sortKey = Object.keys(p).find((k) => /sort|order|rank/i.test(k));
  for (const v of (sortKey && p[sortKey]!.enum) || []) sets.push({ ...base, [sortKey!]: v });
  return sets;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  if (calls++ >= Number(process.env.CURATOR_MAX_MCP_CALLS ?? 120))
    throw new Error("MCP call cap reached");
  await sleep(MIN_INTERVAL);
  try {
    return { ok: true, result: await client.callTool({ name, arguments: args }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ids found anywhere in a tool result (structured content or JSON text). */
export function idsIn(result: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (
          /^(id|question_?id|prediction_?id|slug)$/i.test(k) &&
          (typeof x === "string" || typeof x === "number")
        )
          out.add(String(x));
        walk(x);
      }
    }
  };
  const r = result as { structuredContent?: unknown; content?: { type: string; text?: string }[] };
  walk(r?.structuredContent);
  for (const c of r?.content ?? []) {
    if (c.type !== "text" || !c.text) continue;
    try {
      walk(JSON.parse(c.text));
    } catch {
      // prose, not JSON
    }
  }
  return [...out];
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { client } = await connectPartner();
  const { tools } = await client.listTools();
  writeFileSync(`${OUT}tools.json`, JSON.stringify(tools, null, 2));
  console.log(`tools/list: ${tools.length} tool(s)`);
  for (const t of tools)
    console.log(
      `- ${t.name}${isReadOnly(t) ? "" : "   [skipped: may write/publish]"}\n    ${(t.description ?? "").slice(0, 160)}`,
    );
  const readers = tools.filter(isReadOnly);
  const listers = readers.filter(
    (t) => !/\bget\b/i.test(t.name.replace(/[_-]/g, " ")) || /list|search/i.test(t.name),
  );
  const getter = readers.find(
    (t) => /\bget\b/i.test(t.name.replace(/[_-]/g, " ")) && !/list|search/i.test(t.name),
  );
  const summary: Record<string, unknown> = {};
  for (const category of CATEGORIES) {
    const runs = [];
    for (const t of listers)
      for (const args of argSets(t, category))
        runs.push({ tool: t.name, args, ...(await call(client, t.name, args)) });
    const ids = [...new Set(runs.flatMap((r) => (r.ok ? idsIn(r.result) : [])))];
    const gets = [];
    if (getter) {
      const key = Object.keys(props(getter))[0] ?? "id";
      for (const id of ids.slice(0, 2))
        gets.push({
          tool: getter.name,
          args: { [key]: id },
          ...(await call(client, getter.name, { [key]: id })),
        });
    }
    writeFileSync(`${OUT}${category.toLowerCase()}.json`, JSON.stringify({ runs, gets }, null, 2));
    summary[category] = {
      calls: runs.length,
      okCalls: runs.filter((r) => r.ok).length,
      ids: ids.length,
      gets: gets.length,
    };
    console.log(
      `${category}: ${runs.filter((r) => r.ok).length}/${runs.length} calls ok, ${ids.length} ids, ${gets.length} gets`,
    );
  }
  writeFileSync(
    `${OUT}summary.json`,
    JSON.stringify({ at: new Date().toISOString(), calls, summary }, null, 2),
  );
  console.log(`\nSaved raw responses to ${OUT} (${calls} MCP calls).`);
  await client.close();
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
