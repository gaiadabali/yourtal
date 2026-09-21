import type { IdrMinorUnits } from "@yourtal/contracts/money";
import type { PartialRedemptionPolicy } from "@yourtal/contracts/listing";
import { Badge } from "@yourtal/ui/badge";
import { getStoreTranslator, type SupportedLocale } from "./store-i18n";
import {
  partialRedemptionPolicyDescription,
  partialRedemptionPolicyLabel,
  transferabilityDescription,
} from "./store-redemption-policy";

type SupportedCurrency = "AUD" | "IDR";

export interface StoreOfferTermsProps {
  partialRedemptionPolicy: PartialRedemptionPolicy;
  minimumSpendIdr: IdrMinorUnits | null;
  transferable: boolean;
  /** YT-0405: required, not defaulted — see `store-balance-notice.tsx`'s report for why. */
  locale: SupportedLocale;
  currency: SupportedCurrency;
}

/**
 * The terms block for the offer detail page (YT-0421 acceptance: "Terms,
 * minimum spend, transferability and partial-redemption policy above the
 * fold, before any action"). Rendered by `StoreOfferCard` immediately after
 * the price, and before every other section including the redeem steps and
 * the redeem button — never behind a collapsed/expandable panel, so it
 * cannot be missed on the way to the primary action.
 *
 * The minimum-spend amount is stated once, inside
 * `partialRedemptionPolicyDescription`'s own sentence, rather than
 * repeated in a second row — it is only meaningful for that one policy
 * branch, so a second, always-rendered row would either duplicate it or
 * need the same conditional again for no benefit.
 */
export function StoreOfferTerms({
  partialRedemptionPolicy,
  minimumSpendIdr,
  transferable,
  locale,
  currency,
}: StoreOfferTermsProps) {
  const t = getStoreTranslator(locale);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface px-3 py-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{t("offer.termsBadge")}</Badge>
        <span className="text-xs font-medium text-fg">
          {partialRedemptionPolicyLabel(partialRedemptionPolicy, locale)}
        </span>
      </div>
      <p className="text-xs text-fg-muted">
        {partialRedemptionPolicyDescription(
          partialRedemptionPolicy,
          minimumSpendIdr,
          locale,
          currency,
        )}
      </p>
      <p className="text-xs text-fg-muted">{transferabilityDescription(transferable, locale)}</p>
    </div>
  );
}
