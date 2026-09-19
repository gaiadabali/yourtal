import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRedeemData } from "@/features/burn/burn-data";
import { computeLockExpiresAt } from "@/features/burn/price-lock";
import { BurnFlow } from "@/features/burn/burn-flow";

export interface RedeemPageProps {
  params: Promise<{ listingId: string }>;
}

/**
 * Renders fresh on every request rather than being statically optimised.
 * The price lock (see `features/burn/price-lock.ts`) is anchored to the
 * instant THIS page is rendered — a build-time snapshot would lock every
 * visitor to the same stale expiry, and the "Muat ulang harga" recovery in
 * `burn-flow.tsx` (`router.refresh()`) would replay cached HTML instead of
 * minting a genuinely new quote.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: RedeemPageProps): Promise<Metadata> {
  const { listingId } = await params;
  const data = await getRedeemData(listingId);
  return { title: data ? `Tukar ${data.listing.title} · YourTal` : "Tukar Poin · YourTal" };
}

/**
 * `/store/[listingId]/redeem` (YT-0422) — the burn flow with a price lock.
 * Server Component per docs/13b-typescript-standards.md section 8: loads
 * the listing and the current balance, computes the price-lock expiry at
 * render time (the moment the price is shown), and hands all three to
 * `BurnFlow`, the one client leaf that owns the countdown, the confirmation
 * step, and the success/failure/expired states.
 *
 * An unknown `listingId` 404s here exactly as it does on the offer detail
 * page it is linked from (`/store/[listingId]`, YT-0421) — see
 * `features/burn/burn-data.ts`'s doc comment on why the two routes share
 * one catalogue.
 */
export default async function RedeemPage({ params }: RedeemPageProps) {
  const { listingId } = await params;
  const data = await getRedeemData(listingId);

  if (!data) {
    notFound();
  }

  const lockExpiresAt = computeLockExpiresAt(new Date());

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-sans font-semibold text-fg">Tukar Poin</h1>
        <p className="text-sm font-sans text-fg-muted">{data.listing.merchantName}</p>
      </header>
      {/* Keyed by the quote's own expiry: a re-quote (a fresh render after
          "Muat ulang harga") mounts a brand-new BurnFlow instance with a
          fresh lock and a `reviewing` state, instead of a stale
          `failed`/`lock_expired` state surviving across the new quote. */}
      <BurnFlow key={lockExpiresAt} listing={data.listing} balance={data.balance} lockExpiresAt={lockExpiresAt} />
    </main>
  );
}
