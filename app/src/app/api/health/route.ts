import { NextResponse } from "next/server";
import { CLUSTER, PROGRAM_ID } from "@/lib/constants";
import { redisKind } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** Railway healthcheck. Config only — never touches the RPC (no quota burn). */
export function GET() {
  return NextResponse.json({
    ok: true,
    cluster: CLUSTER,
    programId: PROGRAM_ID.toBase58(),
    redis: redisKind,
  });
}
