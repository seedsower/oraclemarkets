import { createHmac, randomBytes } from "node:crypto";

/**
 * OAuth 1.0a (HMAC-SHA1) request signing for X API user context. Used with the
 * Access Token + Secret generated in the developer portal (Keys and tokens) —
 * no browser authorization step, and the tokens don't expire.
 */
export interface OAuth1Keys {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
export const pct = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export interface SignInput {
  method: string;
  /** Full URL; its query parameters are included in the signature. */
  url: string;
  keys: OAuth1Keys;
  /** Form-encoded body params (JSON bodies are NOT signed). */
  bodyParams?: Record<string, string>;
  nonce?: string;
  timestamp?: number;
}

export function oauth1Header(i: SignInput): string {
  const u = new URL(i.url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: i.keys.consumerKey,
    oauth_nonce: i.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(i.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: i.keys.token,
    oauth_version: "1.0",
  };
  const params: [string, string][] = [
    ...Object.entries(oauth),
    ...[...u.searchParams.entries()],
    ...Object.entries(i.bodyParams ?? {}),
  ].map(([k, v]) => [pct(k), pct(v)]);
  params.sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1));
  const paramString = params.map(([k, v]) => `${k}=${v}`).join("&");
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const base = [i.method.toUpperCase(), pct(baseUrl), pct(paramString)].join("&");
  const key = `${pct(i.keys.consumerSecret)}&${pct(i.keys.tokenSecret)}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");
  const header = { ...oauth, oauth_signature: signature };
  return (
    "OAuth " +
    Object.entries(header)
      .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
      .join(", ")
  );
}
