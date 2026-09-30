import { NextResponse } from "next/server";
import { CLUSTER, PROGRAM_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Railway healthcheck. Config only — never touches the RPC (no quota burn). */
export function GET() {
  const redis = process.env.REDIS_URL
    ? "tcp"
    : process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
      ? "upstash"
      : "none";
  return NextResponse.json({ ok: true, cluster: CLUSTER, programId: PROGRAM_ID.toBase58(), redis });
}
