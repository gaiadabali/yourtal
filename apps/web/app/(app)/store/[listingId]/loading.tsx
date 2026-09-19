import { StoreOfferCardSkeleton } from "@/features/store/store-offer-card-skeleton";

/** Loading state for the offer detail page (YT-0421). */
export default function StoreOfferLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <StoreOfferCardSkeleton />
    </div>
  );
}
