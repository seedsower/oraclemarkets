import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Partner feed: an MCP client for oraclemarkets.io's AI forecasts.
 *
 * Auth is OAuth (their Supabase login) — there is no API key. A person signs
 * in once (`pnpm --filter @oracle-markets/curator login`); the client
 * registration and tokens are kept in a private file OUTSIDE the repo
 * (PARTNER_MCP_AUTH_FILE, default ~/.config/oracle-markets/partner-mcp-auth.json,
 * mode 600) and the SDK refreshes the access token from it. Refresh tokens
 * rotate, so the file is rewritten on every refresh. If the partner ever issues
 * a static token, set PARTNER_MCP_TOKEN and no sign-in is needed.
 */
export const PARTNER_MCP_URL =
  process.env.PARTNER_MCP_URL ?? "https://gulvgtvnzgjgchmqvwwc.supabase.co/functions/v1/mcp";
export const AUTH_FILE =
  process.env.PARTNER_MCP_AUTH_FILE ?? `${homedir()}/.config/oracle-markets/partner-mcp-auth.json`;
export const CALLBACK_PORT = Number(process.env.PARTNER_MCP_CALLBACK_PORT ?? 8765);

interface Stored {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
}

/** OAuth state persisted to a mode-600 JSON file. */
export class FileOAuthProvider implements OAuthClientProvider {
  /** Set when the SDK needs a browser sign-in (the login script prints it). */
  authorizationUrl: URL | null = null;

  constructor(private readonly file = AUTH_FILE) {}

  private read(): Stored {
    return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Stored) : {};
  }

  private write(patch: Stored): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(this.file, JSON.stringify({ ...this.read(), ...patch }, null, 2), {
      mode: 0o600,
    });
    chmodSync(this.file, 0o600);
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${CALLBACK_PORT}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Oracle Markets curator",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation = () => this.read().client;
  saveClientInformation = (client: OAuthClientInformationMixed) => this.write({ client });
  tokens = () => this.read().tokens;
  saveTokens = (tokens: OAuthTokens) => this.write({ tokens });
  saveCodeVerifier = (verifier: string) => this.write({ verifier });

  codeVerifier(): string {
    const v = this.read().verifier;
    if (!v) throw new Error("no PKCE verifier saved — run the login script");
    return v;
  }

  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url;
  }
}

/** Bearer header when a static PARTNER_MCP_TOKEN is set; otherwise OAuth via `provider`. */
function transportOptions(provider: OAuthClientProvider) {
  const token = process.env.PARTNER_MCP_TOKEN;
  return token
    ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    : { authProvider: provider };
}

/** Connected MCP client (Streamable HTTP, falling back to SSE). */
export async function connectPartner(
  provider: OAuthClientProvider = new FileOAuthProvider(),
): Promise<{ client: Client; transport: StreamableHTTPClientTransport | SSEClientTransport }> {
  const url = new URL(PARTNER_MCP_URL);
  const client = new Client({ name: "oracle-markets-curator", version: "0.1.0" });
  try {
    const transport = new StreamableHTTPClientTransport(url, transportOptions(provider));
    await client.connect(transport);
    return { client, transport };
  } catch (e) {
    if ((e as Error).name === "UnauthorizedError") throw e;
    const sse = new SSEClientTransport(url, transportOptions(provider));
    await client.connect(sse);
    return { client, transport: sse };
  }
}
