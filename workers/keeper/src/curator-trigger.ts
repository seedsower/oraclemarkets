/**
 * Manual curator runs. The web's admin-only POST /api/admin/curator/run sets
 * `curator:run-request` in Redis; the keeper (not the web process) picks it up
 * and asks Railway to execute the curator's cron job now. The curator is a
 * run-once job, so this is the same as Railway's "Run now" button.
 *
 * Needs CURATOR_TRIGGER_TOKEN (a Railway *project* token for this project only)
 * and CURATOR_SERVICE_ID; RAILWAY_ENVIRONMENT_ID is set by Railway. Unset → off.
 *
 *   curator:run-request  JSON {by, at}   (set by the web, NX + 1 h expiry; consumed here)
 *   curator:run-status   JSON {by, requestedAt, triggeredAt?, error?}  (read by /admin)
 */
import type IORedis from "ioredis";

export const REQUEST_KEY = "curator:run-request";
export const STATUS_KEY = "curator:run-status";
const API = "https://backboard.railway.com/graphql/v2";

export interface TriggerConfig {
  token: string;
  serviceId: string;
  environmentId: string;
}

export function loadTriggerConfig(env = process.env): TriggerConfig | null {
  const token = env.CURATOR_TRIGGER_TOKEN;
  const serviceId = env.CURATOR_SERVICE_ID;
  const environmentId = env.RAILWAY_ENVIRONMENT_ID;
  return token && serviceId && environmentId ? { token, serviceId, environmentId } : null;
}

type Fetch = typeof fetch;

async function gql(cfg: TriggerConfig, query: string, variables: object, f: Fetch) {
  const res = await f(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Project-Access-Token": cfg.token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: Record<string, unknown>;
    errors?: { message: string }[];
  };
  if (!res.ok || body.errors?.length)
    throw new Error(body.errors?.[0]?.message ?? `railway ${res.status}`);
  return body.data ?? {};
}

/** Ask Railway to run the curator's cron job now. */
export async function runCuratorNow(cfg: TriggerConfig, f: Fetch = fetch): Promise<void> {
  const data = await gql(
    cfg,
    "query($s:String!,$e:String!){ serviceInstance(serviceId:$s, environmentId:$e){ id } }",
    { s: cfg.serviceId, e: cfg.environmentId },
    f,
  );
  const id = (data.serviceInstance as { id?: string } | undefined)?.id;
  if (!id) throw new Error("curator service instance not found");
  await gql(
    cfg,
    "mutation($i:String!){ deploymentInstanceExecutionCreate(input:{ serviceInstanceId:$i }) }",
    { i: id },
    f,
  );
}

/** Consume a pending request (if any) and trigger the run; the outcome goes to STATUS_KEY. */
export async function maybeTriggerCurator(
  redis: Pick<IORedis, "getdel" | "set">,
  cfg: TriggerConfig | null,
  f: Fetch = fetch,
): Promise<"none" | "triggered" | "failed" | "disabled"> {
  const raw = await redis.getdel(REQUEST_KEY);
  if (!raw) return "none";
  let req: { by?: string; at?: string } = {};
  try {
    req = JSON.parse(raw) as typeof req;
  } catch {
    // malformed request: still answer it
  }
  const status = { by: req.by ?? "", requestedAt: req.at ?? "" };
  if (!cfg) {
    await redis.set(STATUS_KEY, JSON.stringify({ ...status, error: "trigger not configured" }));
    return "disabled";
  }
  try {
    await runCuratorNow(cfg, f);
    await redis.set(
      STATUS_KEY,
      JSON.stringify({ ...status, triggeredAt: new Date().toISOString() }),
    );
    return "triggered";
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 200) : String(e);
    await redis.set(STATUS_KEY, JSON.stringify({ ...status, error }));
    return "failed";
  }
}
