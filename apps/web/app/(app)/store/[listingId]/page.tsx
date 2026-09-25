import { notFound } from "next/navigation";
import { StoreOfferCard } from "@/features/store/store-offer-card";
import { getCurrentBalance } from "@/features/store/store-balance-data";
import { getListing } from "@/features/store/store-data";
import { getRegionDisplayConfig } from "@/features/region/get-region";

/**
 * The offer detail page (YT-0421) — `/store/[listingId]`. Server Component
 * per docs/13b-typescript-standards.md §8: the card itself has no
 * interactive state (its one action is a plain `<a>` to the redeem flow,
 * YT-0422), so nothing here needs `"use client"`.
 */
export default async function StoreOfferPage(props: PageProps<"/store/[listingId]">) {
  const { listingId } = await props.params;
  const listing = await getListing(listingId);

  if (!listing) {
    notFound();
  }

  const [balance, { locale }] = await Promise.all([getCurrentBalance(), getRegionDisplayConfig()]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <StoreOfferCard listing={listing} balance={balance} locale={locale} />
    </div>
  );
}
