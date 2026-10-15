import type { Metadata } from "next";
import type { MarketView } from "@pm-amm/sdk";
import { BRAND } from "@/lib/brand";
import { getGroupById, parseId } from "@/lib/server/snapshots";
import { cents, closesIn, groupPath, legLabel } from "@/lib/share";
import { GroupPage } from "./group-page";

type Props = { params: Promise<{ id: string }> };

export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const groupId = parseId(id);
  const g = groupId === null ? null : await getGroupById(groupId);
  if (!g) return { title: `Market #${id}` };
  const top = g.legs
    .filter((l): l is MarketView => l !== null)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
    .map((l) => `${legLabel(l.name)} ${cents(l.price)}`);
  const description = [...top, g.resolved ? "resolved" : closesIn(g.endTs)].join(" · ");
  return {
    title: g.name,
    description,
    alternates: { canonical: groupPath(g.groupId) },
    openGraph: { title: g.name, description, type: "website", siteName: BRAND.name },
    twitter: {
      card: "summary_large_image",
      title: g.name,
      description,
      site: BRAND.xAt,
    },
  };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <GroupPage id={id} />;
}
