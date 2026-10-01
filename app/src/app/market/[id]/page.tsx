import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { getMarketById, parseId } from "@/lib/server/snapshots";
import { marketPath, marketSummary } from "@/lib/share";
import { MarketPage } from "./market-page";

type Props = { params: Promise<{ id: string }> };

// Metadata reads the keeper cache (or one RPC call); refresh it like the card.
export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const marketId = parseId(id);
  const m = marketId === null ? null : await getMarketById(marketId);
  if (!m) return { title: `Market #${id}` };
  const description = marketSummary(m);
  return {
    // The layout's title template appends " · Oracle Markets".
    title: m.name,
    description,
    alternates: { canonical: marketPath(m.marketId) },
    openGraph: { title: m.name, description, type: "website", siteName: BRAND.name },
    twitter: {
      card: "summary_large_image",
      title: m.name,
      description,
      ...(BRAND.xHandle ? { site: BRAND.xHandle } : {}),
    },
  };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <MarketPage id={id} />;
}
