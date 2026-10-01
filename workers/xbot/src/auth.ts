/**
 * One-time OAuth 2.0 (PKCE) login for the bot account — run locally:
 *
 *   X_CLIENT_ID=… X_CLIENT_SECRET=… pnpm --filter @oracle-markets/xbot auth
 *
 * Open the printed URL while logged into the BOT account on x.com, approve,
 * and copy the printed X_BOT_USER_ID + X_REFRESH_TOKEN into Railway (xbot
 * service). The app's callback URI must be http://127.0.0.1:3333/callback.
 * After the first refresh, the bot keeps the rotated token in Redis.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

const PORT = Number(process.env.XBOT_AUTH_PORT || 3333);
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = "tweet.read tweet.write users.read offline.access";

const b64url = (b: Buffer) => b.toString("base64url");

function authorizeUrl(clientId: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  // X's docs encode the scope list with %20; URLSearchParams would use "+".
  return `https://x.com/i/oauth2/authorize?${q.toString().replace(/\+/g, "%20")}`;
}

async function exchange(code: string, verifier: string, id: string, secret: string) {
  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      client_id: id,
    }),
  });
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
  };
  if (!res.ok || !body.access_token)
    throw new Error(`token exchange failed: ${JSON.stringify(body)}`);
  if (!body.refresh_token)
    throw new Error("no refresh_token — is offline.access enabled for the app?");
  return body as { access_token: string; refresh_token: string; scope?: string };
}

async function me(accessToken: string): Promise<{ id: string; username: string }> {
  const res = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json()) as { data?: { id: string; username: string } };
  if (!body.data) throw new Error(`users/me failed: ${JSON.stringify(body)}`);
  return body.data;
}

/**
 * OAuth 2.0 Client IDs base64-decode to "<id>:1:ci". The API Key (consumer
 * key) from the same page doesn't — and using it makes X's consent page say
 * "You weren't able to give access to the App".
 */
export function looksLikeOAuth2ClientId(id: string): boolean {
  try {
    return Buffer.from(id, "base64").toString("utf8").endsWith(":1:ci");
  } catch {
    return false;
  }
}

function main() {
  const id = process.env.X_CLIENT_ID;
  const secret = process.env.X_CLIENT_SECRET;
  if (!id || !secret) {
    console.error(
      "Set X_CLIENT_ID and X_CLIENT_SECRET (OAuth 2.0 keys from the X developer portal).",
    );
    process.exit(1);
  }
  if (!looksLikeOAuth2ClientId(id)) {
    console.warn(
      "⚠ X_CLIENT_ID doesn't look like an OAuth 2.0 Client ID. In the developer portal, use\n" +
        "  Keys and tokens → OAuth 2.0 Client ID and Client Secret, NOT the API Key / API Key Secret.\n",
    );
  }
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  let done = false;

  /** Finish from the redirect URL — via the local server OR pasted by hand. */
  async function complete(redirected: URL): Promise<string> {
    if (done) return "Already completed.";
    const err = redirected.searchParams.get("error");
    if (err)
      throw new Error(
        `X returned "${err}": ${redirected.searchParams.get("error_description") ?? ""}`,
      );
    if (redirected.searchParams.get("state") !== state)
      throw new Error("state mismatch — use the link from THIS run");
    const code = redirected.searchParams.get("code");
    if (!code) throw new Error("no ?code= in that URL");
    done = true;
    const tok = await exchange(code, verifier, id!, secret!);
    const user = await me(tok.access_token);
    console.log(`\nAuthorized as @${user.username} (scopes: ${tok.scope ?? SCOPES})\n`);
    console.log("Set these on the Railway xbot service (keep them secret):\n");
    console.log(`X_BOT_USER_ID=${user.id}`);
    console.log(`X_REFRESH_TOKEN=${tok.refresh_token}\n`);
    console.log("The bot rotates this token on first use and stores the new one in Redis.");
    return `Authorized @${user.username}. You can close this tab and return to the terminal.`;
  }

  const finish = (ok: boolean) => {
    server.close();
    rl.close();
    process.exitCode = ok ? 0 : 1;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", REDIRECT);
    if (url.pathname !== "/callback") return void res.writeHead(404).end();
    try {
      res.end(await complete(url));
      finish(true);
    } catch (e) {
      res.writeHead(400).end(`Auth failed: ${(e as Error).message}`);
      console.error(`Auth failed: ${(e as Error).message}`);
      if (done) finish(false);
    }
  });

  // Fallback when the browser can't reach this machine's 127.0.0.1 (remote
  // shells, VS Code Remote, another device): paste the address-bar URL.
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) return;
    try {
      await complete(
        new URL(text.startsWith("http") ? text : `${REDIRECT}?${text.replace(/^\?/, "")}`),
      );
      finish(true);
    } catch (e) {
      console.error(`Couldn't use that: ${(e as Error).message}`);
      if (done) finish(false);
    }
  });

  server.on("error", (e) =>
    console.warn(`(local callback server unavailable: ${e.message} — paste the URL instead)`),
  );
  server.listen(PORT, "127.0.0.1");
  console.log(
    "1. In a browser logged into the BOT account on x.com, open this URL and click Authorize:\n",
  );
  console.log(authorizeUrl(id, challenge, state));
  console.log(`\n2. You'll be sent to ${REDIRECT}?state=…&code=…`);
  console.log("   If that page says it can't be reached, that's fine: copy the FULL URL from the");
  console.log(
    "   address bar, paste it here and press Enter. (The code expires in about 30 seconds.)\n",
  );
}

main();
