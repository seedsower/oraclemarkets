import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * "Sign in with X" over OAuth 1.0a (the app's existing X_API_KEY/SECRET, so no
 * extra credentials): request token → x.com/oauth/authenticate → access
 * token, which tells us the X user id + handle. We keep only that, in a signed
 * cookie; the user's X tokens are discarded. The callback URL
 * `${SITE}/api/auth/x/callback` must be listed in the X app's settings.
 */
const API = "https://api.x.com";
export const SESSION_COOKIE = "om_x";
export const TEMP_COOKIE = "om_x_tmp";
export const SESSION_SECS = 7 * 86_400;

const pct = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

function consumer() {
  const key = process.env.X_API_KEY;
  const secret = process.env.X_API_SECRET;
  if (!key || !secret) throw new Error("X_API_KEY / X_API_SECRET not set");
  return { key, secret };
}

/** OAuth 1.0a HMAC-SHA1 header; `extra` = oauth_callback / oauth_verifier. */
function header(
  method: string,
  url: string,
  token: { key: string; secret: string } | null,
  extra: Record<string, string>,
) {
  const c = consumer();
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.key,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...(token ? { oauth_token: token.key } : {}),
    ...extra,
  };
  const params = Object.entries(oauth)
    .map(([k, v]) => [pct(k), pct(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method, pct(url), pct(params)].join("&");
  const sig = createHmac("sha1", `${pct(c.secret)}&${pct(token?.secret ?? "")}`)
    .update(base)
    .digest("base64");
  return (
    "OAuth " +
    Object.entries({ ...oauth, oauth_signature: sig })
      .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
      .join(", ")
  );
}

async function post(
  path: string,
  token: { key: string; secret: string } | null,
  extra: Record<string, string>,
) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: header("POST", url, token, extra) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  return new URLSearchParams(text);
}

export async function requestToken(callback: string): Promise<{ key: string; secret: string }> {
  const q = await post("/oauth/request_token", null, { oauth_callback: callback });
  const key = q.get("oauth_token");
  const secret = q.get("oauth_token_secret");
  if (!key || !secret || q.get("oauth_callback_confirmed") !== "true")
    throw new Error("request_token refused");
  return { key, secret };
}

export const authenticateUrl = (token: string) =>
  `${API}/oauth/authenticate?oauth_token=${pct(token)}`;

/** Exchange the verifier; returns who signed in. */
export async function accessToken(token: { key: string; secret: string }, verifier: string) {
  const q = await post("/oauth/access_token", token, { oauth_verifier: verifier });
  const userId = q.get("user_id");
  const handle = q.get("screen_name");
  if (!userId || !handle) throw new Error("access_token: no user");
  return { userId, handle };
}

// ── signed cookies ───────────────────────────────────────────────────────────

/** HMAC key for cookies, derived from the wallet master key (no extra secret to manage). */
function cookieKey(): Buffer {
  const master = process.env.XBOT_WALLET_MASTER_KEY;
  if (!master) throw new Error("XBOT_WALLET_MASTER_KEY not set");
  return createHmac("sha256", Buffer.from(master, "base64"))
    .update("oracle-markets-cookie-v1")
    .digest();
}

export function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", cookieKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T>(value: string | undefined): T | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", cookieKey()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

export interface XSession {
  uid: string;
  handle: string;
  /** Unix seconds at sign-in. */
  iat: number;
}

/** A valid, unexpired session from the cookie value. */
export function readSession(value: string | undefined): XSession | null {
  const s = verify<XSession>(value);
  return s && Date.now() / 1000 - s.iat < SESSION_SECS ? s : null;
}
