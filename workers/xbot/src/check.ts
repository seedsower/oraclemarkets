/**
 * Verify OAuth 1.0a keys before putting them on Railway — reads only, never posts:
 *
 *   X_API_KEY=… X_API_SECRET=… X_ACCESS_TOKEN=… X_ACCESS_SECRET=… npx tsx src/check.ts
 *
 * Prints the account the Access Token belongs to (the bot will reply as it)
 * and whether reading its mentions works.
 */
import { oauth1Header, type OAuth1Keys } from "./oauth1";

const API = "https://api.x.com/2";

/** Plain-English hints for the errors people actually hit. */
function hint(status: number, body: string): string {
  if (status === 401)
    return "Keys rejected. Re-copy all four values; regenerate the Access Token if unsure.";
  if (/project/i.test(body)) return "The X app must be inside a Project in the developer portal.";
  if (/oauth1-permissions|not permitted|permission/i.test(body)) {
    return "Set app permissions to 'Read and write', then REGENERATE the Access Token + Secret (old tokens keep the old permissions).";
  }
  if (status === 402 || /credits|payment|plan/i.test(body))
    return "Your X API plan/credits don't cover this endpoint.";
  if (status === 403) return "Access denied — check the app's plan, Project, and permissions.";
  return "Unexpected error.";
}

async function get(keys: OAuth1Keys, url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    headers: { Authorization: oauth1Header({ method: "GET", url, keys }) },
  });
  return { status: res.status, body: await res.text() };
}

async function main() {
  const e = process.env;
  if (!e.X_API_KEY || !e.X_API_SECRET || !e.X_ACCESS_TOKEN || !e.X_ACCESS_SECRET) {
    console.error("Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_SECRET.");
    process.exit(1);
  }
  const keys = {
    consumerKey: e.X_API_KEY,
    consumerSecret: e.X_API_SECRET,
    token: e.X_ACCESS_TOKEN,
    tokenSecret: e.X_ACCESS_SECRET,
  };

  const me = await get(keys, `${API}/users/me`);
  if (me.status !== 200) {
    console.error(
      `✗ users/me → ${me.status}\n  ${me.body.slice(0, 300)}\n  → ${hint(me.status, me.body)}`,
    );
    process.exit(1);
  }
  const user = (JSON.parse(me.body) as { data: { id: string; username: string } }).data;
  console.log(`✓ Keys work. The bot will post as @${user.username} (user id ${user.id}).`);

  const mentions = await get(keys, `${API}/users/${user.id}/mentions?max_results=5`);
  if (mentions.status !== 200) {
    console.error(
      `✗ reading mentions → ${mentions.status}\n  ${mentions.body.slice(0, 300)}\n  → ${hint(mentions.status, mentions.body)}`,
    );
    process.exit(1);
  }
  const n =
    (JSON.parse(mentions.body) as { meta?: { result_count?: number } }).meta?.result_count ?? 0;
  console.log(`✓ Reading mentions works (${n} recent).`);
  console.log("\nPut the same four values on the Railway xbot service (keep XBOT_DRY_RUN=true).");
  console.log("Posting can't be tested without posting; dry run shows exactly what it would send.");
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
