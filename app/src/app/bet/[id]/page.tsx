import type { Metadata } from "next";
import { formatUsdc } from "@pm-amm/sdk/math";
import { BRAND } from "@/lib/brand";
import { betPath } from "@/lib/bets";
import { getBetById, getBetMeta } from "@/lib/server/bets";
import { parseId } from "@/lib/server/snapshots";
import { BetView } from "./bet-view";

type Props = { params: Promise<{ id: string }> };

export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const vaultId = parseId(id);
  const [v, meta] =
    vaultId === null ? [null, null] : await Promise.all([getBetById(vaultId), getBetMeta(vaultId)]);
  if (!v) return { title: `Bet #${id}` };
  const title = meta?.question ?? v.name;
  const description = `Pot $${formatUsdc(v.total)} · YES ${Math.round(v.impliedYes * 100)}% / NO ${100 - Math.round(v.impliedYes * 100)}% · winner takes the pot`;
  return {
    title,
    description,
    alternates: { canonical: betPath(v.vaultId) },
    openGraph: { title, description, type: "website", siteName: BRAND.name },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      site: BRAND.xAt,
    },
  };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const vaultId = parseId(id);
  const meta = vaultId === null ? null : await getBetMeta(vaultId);
  return <BetView id={id} meta={meta} />;
}
