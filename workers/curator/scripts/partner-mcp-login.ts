/**
 * One-time sign-in to oraclemarkets.io's MCP server (OAuth). Prints a link;
 * open it, sign in, approve — the browser is sent back to 127.0.0.1 and the
 * tokens are saved to PARTNER_MCP_AUTH_FILE (outside the repo, mode 600).
 *
 *   pnpm --filter @oracle-markets/curator login
 */
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { AUTH_FILE, CALLBACK_PORT, FileOAuthProvider, PARTNER_MCP_URL } from "../src/partner-feed";

const TIMEOUT_MS = 10 * 60_000;

/** Resolves with the `code` the authorization server sends back to /callback. */
function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${CALLBACK_PORT}`);
      if (u.pathname !== "/callback") return void res.writeHead(404).end();
      const code = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(code ? "Signed in. You can close this tab." : `Sign-in failed: ${err ?? "no code"}`);
      server.close();
      if (code) resolve(code);
      else reject(new Error(`authorization failed: ${err ?? "no code"}`));
    });
    server.listen(CALLBACK_PORT, "127.0.0.1");
    setTimeout(
      () => (server.close(), reject(new Error("timed out waiting for sign-in"))),
      TIMEOUT_MS,
    );
  });
}

async function main() {
  const provider = new FileOAuthProvider();
  const url = new URL(PARTNER_MCP_URL);
  const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
  const codeP = waitForCode();
  try {
    await new Client({ name: "oracle-markets-curator", version: "0.1.0" }).connect(first);
    console.log("Already signed in (saved tokens still work).");
  } catch (e) {
    if (!(e instanceof UnauthorizedError) || !provider.authorizationUrl) throw e;
    console.log("\nOpen this link in your browser, sign in to oraclemarkets.io and approve:\n");
    console.log(provider.authorizationUrl.toString(), "\n");
    console.log(`Waiting for the redirect to http://127.0.0.1:${CALLBACK_PORT}/callback …`);
    await first.finishAuth(await codeP);
  }
  const client = new Client({ name: "oracle-markets-curator", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }));
  const { tools } = await client.listTools();
  console.log(`\n✓ Signed in. Tokens saved to ${AUTH_FILE}`);
  console.log(
    `  The server offers ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`,
  );
  await client.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
