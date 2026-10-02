import { serveCachedList } from "@/lib/list-cache";

export const dynamic = "force-dynamic";

/** Keeper-cached bet vaults (see lib/list-cache.ts); 503 → clients fall back to RPC. */
export function GET() {
  return serveCachedList("betVaults");
}
