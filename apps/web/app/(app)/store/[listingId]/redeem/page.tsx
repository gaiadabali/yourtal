import type { Metadata } from "next";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { getListing } from "@/features/store/store-data";
import { getCurrentBalance } from "@/features/store/store-balance-data";
import { quoteCheckout } from "@/features/burn/checkout-data";
import { burnErrorFromApiError } from "@/features/burn/burn-errors";
import { BurnFlow } from "@/features/burn/burn-flow";
import { RedeemQuoteFailurePanel } from "@/features/burn/redeem-quote-failure-panel";
import { getDisplayLocale } from "@/i18n/get-locale";
import { getStoreTranslator } from "@/features/store/store-i18n";

export interface RedeemPageProps {
  params: Promise<{ listingId: string }>;
}

/**
 * Renders fresh on every request rather than being statically optimised.
 * The price lock (`POST /api/checkout/quote`, 11.6.b) is anchored to the
 * instant THIS page is rendered — a build-time snapshot would lock every
 * visitor to the same stale expiry, and the "Muat ulang harga" recovery in
 * `burn-flow.tsx` (`router.refresh()`) would replay cached HTML instead of
 * asking the ledger for a genuinely new quote.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: RedeemPageProps): Promise<Metadata> {
  const { listingId } = await params;
  const [listing, locale] = await Promise.all([getListing(listingId), getDisplayLocale()]);
  const t = getStoreTranslator(locale);
  const title = listing
    ? t("redeem.pageTitleWithName", { itemTitle: listing.title })
    : t("redeem.pageTitleGeneric");
  return { title: `${title} · YourTal` };
}

/**
 * `/store/[listingId]/redeem` (11.6.b) — the real checkout flow with a real,
 * server-locked price. Server Component per docs/13b-typescript-standards.md
 * section 8: loads the listing, the current balance and a fresh checkout
 * quote in parallel, then hands the outcome to `BurnFlow`, the one client
 * leaf that owns the countdown, the confirmation step, and the
 * success/failure/expired states.
 *
 * An unknown `listingId` 404s here exactly as it does on the offer detail
 * page it is linked from (`/store/[listingId]`) — `getListing` and
 * `quoteCheckout` both read the SAME live `GET`/`POST /api/store`,
 * `/api/checkout` routes, which enforce the region/audience wall
 * server-side from the caller's own principal, so there is no separate
 * catalogue to drift out of step with (11.6.a's whole point).
 *
 * A quote REFUSAL (region mismatch, audience block, sold out, or any other
 * 1.2.c code) is not one of `BurnFlow`'s own states — there is no checkout
 * to review yet — so it renders `RedeemQuoteFailurePanel` instead.
 */
export default async function RedeemPage({ params }: RedeemPageProps) {
  const { listingId } = await params;
  const [listing, balance, quoted, locale] = await Promise.all([
    getListing(listingId),
    getCurrentBalance(),
    quoteCheckout(listingId),
    getDisplayLocale(),
  ]);

  if (!listing) {
    notFound();
  }

  const t = getStoreTranslator(locale);
  const storeHref = `/store/${listing.id}` as Route;

  if (!quoted.ok) {
    // No `lockExpiresAt` exists yet for a refusal at this stage — a
    // server-side `quote_expired` can only come back from CONFIRMING an
    // already-quoted checkout (`burnErrorFromApiError`'s own doc comment),
    // never from asking for a brand new one, so this placeholder is never
    // actually read.
    const error = burnErrorFromApiError(quoted.error, new Date(0).toISOString());
    return (
      // A plain `<div>`, not `<main>`: the app shell (`features/shell/app-shell.tsx`)
      // already renders the page's one `<main>` landmark — nesting a second
      // one here is a real axe `landmark-no-duplicate-main`/`landmark-unique`
      // violation, found verifying this task, same fix `store/[listingId]/page.tsx`
      // already applies.
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-24">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-sans font-semibold text-fg">
            {t("redeem.pageTitleGeneric")}
          </h1>
          <p className="text-sm font-sans text-fg-muted">{listing.merchantName}</p>
        </header>
        <RedeemQuoteFailurePanel error={error} storeHref={storeHref} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-sans font-semibold text-fg">{t("redeem.pageTitleGeneric")}</h1>
        <p className="text-sm font-sans text-fg-muted">{listing.merchantName}</p>
      </header>
      {/* Keyed by the quote's own expiry: a re-quote (a fresh render after
          "Muat ulang harga") mounts a brand-new BurnFlow instance with a
          fresh lock, checkout id and price, instead of a stale
          `failed`/`lock_expired` state surviving across the new quote. */}
      <BurnFlow
        key={quoted.data.expiresAt}
        listing={listing}
        balance={balance}
        checkoutId={quoted.data.checkoutId}
        pricePoints={quoted.data.pricePoints}
        lockExpiresAt={quoted.data.expiresAt}
      />
    </div>
  );
}
