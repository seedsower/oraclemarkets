"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { CategoryChip, CategoryPicker } from "@/components/category-picker";
import { useCategoryOf, useSetCategory } from "@/hooks/use-categories";
import { categoryAdmins, type CategorySlug } from "@/lib/categories";
import { FEATURED_AUTHORITIES } from "@/lib/featured-list";

/**
 * Shows an account's category; its creator (on-chain authority) can set or
 * change it with one free signature. Admins can too (enforced server-side).
 */
const ADMINS = categoryAdmins(FEATURED_AUTHORITIES);

export function CategoryEditor({
  account,
  authority,
  alsoAllowed,
}: {
  account: string;
  authority: string;
  /** e.g. a bet's resolver */
  alsoAllowed?: string;
}) {
  const categoryOf = useCategoryOf();
  const current = categoryOf(account);
  const { publicKey } = useWallet();
  const setCategory = useSetCategory();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = publicKey?.toBase58();
  // Creator (or a bet's resolver), or a category admin — the API enforces the same.
  const canEdit = !!me && (me === authority || me === alsoAllowed || ADMINS.has(me));

  const choose = async (slug: CategorySlug) => {
    setBusy(true);
    if (await setCategory(account, slug)) setEditing(false);
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      {current ? (
        <CategoryChip slug={current} />
      ) : (
        canEdit && <span className="font-mono text-[11px] text-muted">No category</span>
      )}
      {canEdit && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="font-mono text-[11px] text-muted hover:text-text-hi cursor-pointer"
        >
          {current ? "Change category" : "Set category"}
        </button>
      )}
      {editing && (
        <div className={busy ? "opacity-50 pointer-events-none" : ""}>
          <CategoryPicker value={current} onChange={choose} />
        </div>
      )}
    </div>
  );
}
