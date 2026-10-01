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
  return `https://x.com/i/oauth2/authorize?${q}`;
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

function main() {
  const id = process.env.X_CLIENT_ID;
  const secret = process.env.X_CLIENT_SECRET;
  if (!id || !secret) {
    console.error(
      "Set X_CLIENT_ID and X_CLIENT_SECRET (OAuth 2.0 keys from the X developer portal).",
    );
    process.exit(1);
  }
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", REDIRECT);
    if (url.pathname !== "/callback") return void res.writeHead(404).end();
    try {
      if (url.searchParams.get("state") !== state) throw new Error("state mismatch");
      const code = url.searchParams.get("code");
      if (!code) throw new Error(url.searchParams.get("error") ?? "no code");
      const tok = await exchange(code, verifier, id, secret);
      const user = await me(tok.access_token);
      res.end(`Authorized @${user.username}. You can close this tab and return to the terminal.`);
      console.log(`\nAuthorized as @${user.username} (scopes: ${tok.scope ?? SCOPES})\n`);
      console.log("Set these on the Railway xbot service (keep them secret):\n");
      console.log(`X_BOT_USER_ID=${user.id}`);
      console.log(`X_REFRESH_TOKEN=${tok.refresh_token}\n`);
      console.log("The bot rotates this token on first use and stores the new one in Redis.");
    } catch (e) {
      res.writeHead(400).end(`Auth failed: ${(e as Error).message}`);
      console.error(`Auth failed: ${(e as Error).message}`);
    } finally {
      server.close();
    }
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log("Log into the BOT account on x.com, then open this URL and approve:\n");
    console.log(authorizeUrl(id, challenge, state));
    console.log(`\nWaiting for the callback on ${REDIRECT} …`);
  });
}

main();
