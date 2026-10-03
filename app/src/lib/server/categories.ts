import { createPublicKey, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { FEATURED_AUTHORITIES } from "@/lib/featured-list";
import { serverClient } from "@/lib/server/chain";
import { categoryAdmins } from "@/lib/categories";

/** Max clock skew for a signed category message. */
export const CATEGORY_MAX_SKEW_SECS = 600;

/** Ed25519 check of a Solana wallet's `signMessage` output (no extra deps). */
export function verifyWalletSignature(
  message: string,
  signatureB64: string,
  signer: string,
): boolean {
  try {
    const raw = new PublicKey(signer).toBytes();
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** NEXT_PUBLIC_CATEGORY_ADMINS + featured authorities (see lib/categories). */
const admins = () => categoryAdmins(FEATURED_AUTHORITIES);

/** On-chain owners of an account: its authority (and a bet vault's resolver). */
async function ownersOf(account: string): Promise<string[]> {
  const c = serverClient();
  const pk = new PublicKey(account);
  const tries = [
    () => c.fetchMarket(pk),
    () => c.fetchGroup(pk),
    () => c.fetchVault(pk),
    () => c.fetchVaultGroup(pk),
  ];
  for (const t of tries) {
    const a = await t().catch(() => null);
    if (a) return [a.authority.toBase58()];
  }
  const bet = await c.fetchBetVault(pk).catch(() => null);
  return bet ? [bet.authority.toBase58(), bet.resolver.toBase58()] : [];
}

/** Can `signer` set the category of `account`? (creator/authority, or an admin) */
export async function mayCategorize(account: string, signer: string): Promise<boolean> {
  if (admins().has(signer)) return true;
  return (await ownersOf(account)).includes(signer);
}
