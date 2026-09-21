import { getStoreTranslator, type SupportedLocale } from "./store-i18n";

export interface StoreOfferRedeemStepsProps {
  merchantName: string;
  /** Every district this offer can be redeemed in (YT-0502). */
  districts: readonly string[];
  /** YT-0405: required, not defaulted — see `store-balance-notice.tsx`'s report for why. */
  locale: SupportedLocale;
}

/**
 * "How to redeem" for the offer detail page (YT-0421 acceptance: "Merchant,
 * locations and how to redeem"). The three steps mirror the settlement
 * protocol's shape (docs/09-points-economy-and-redemption.md §8: the
 * voucher is minted on redemption, then honoured at the merchant's own
 * checkout) without describing the burn flow itself — that flow is
 * YT-0422, owned by a different ticket, and this page only needs to set
 * the user's expectation for what happens after they tap the button here.
 */
export function StoreOfferRedeemSteps({
  merchantName,
  districts,
  locale,
}: StoreOfferRedeemStepsProps) {
  const t = getStoreTranslator(locale);
  // Step 3 tells the user where to physically go, so it names every district
  // rather than a representative one. This is the step where showing a single
  // branch of a multi-branch merchant would send someone across a city for no
  // reason.
  const whereLabel = districts.join(", ");
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-fg">{t("redeemSteps.heading")}</h2>
      <ol className="flex flex-col gap-1.5 text-xs text-fg-muted">
        <li>{t("redeemSteps.step1")}</li>
        <li>{t("redeemSteps.step2")}</li>
        <li>{t("redeemSteps.step3", { merchantName, locations: whereLabel })}</li>
      </ol>
    </div>
  );
}
