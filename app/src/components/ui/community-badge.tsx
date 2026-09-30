/** Marks rows not created by a featured authority (see lib/featured.ts). */
export function CommunityBadge() {
  return (
    <span
      title="Community-created market — not curated by this site"
      className="text-[9px] px-[5px] py-[1px] border border-line-2 text-muted font-mono tracking-[0.05em] uppercase shrink-0"
    >
      community
    </span>
  );
}
