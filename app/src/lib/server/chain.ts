import { Connection } from "@solana/web3.js";
import { PmAmmClient } from "@pm-amm/sdk";
import { PROGRAM_ID, RPC_URL, USDC_MINT } from "@/lib/constants";

/**
 * Server-side RPC. SERVER_RPC_URL (or the keeper's KEEPER_RPC_URL when both
 * services share a variable group) keeps server reads off the browser key;
 * falls back to the public cluster default.
 */
export const SERVER_RPC_URL = process.env.SERVER_RPC_URL || process.env.KEEPER_RPC_URL || RPC_URL;

let client: PmAmmClient | null = null;

/** Read-only SDK client for route handlers / metadata / OG images (never signs). */
export function serverClient(): PmAmmClient {
  if (!client) {
    const connection = new Connection(SERVER_RPC_URL, "confirmed");
    client = PmAmmClient.readOnly(connection, PROGRAM_ID, USDC_MINT);
  }
  return client;
}
