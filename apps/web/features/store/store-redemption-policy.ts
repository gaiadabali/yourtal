import type { IdrMinorUnits } from "@yourtal/contracts/money";
import type { PartialRedemptionPolicy } from "@yourtal/contracts/listing";
import { formatMoney } from "@yourtal/contracts/money/format";
import { getStoreTranslator, type SupportedLocale } from "./store-i18n";

type SupportedCurrency = "AUD" | "IDR";

/**
 * Plain-language terms copy for the offer detail page (YT-0421 acceptance:
 * "Terms, minimum spend, transferability and partial-redemption policy
 * above the fold, before any action"). docs/09-points-economy-and-redemption.md
 * §8.2 names the three partial-redemption policies and is explicit that
 * "the policy must be a per-batch flag, displayed prominently before the
 * user spends their points" — this is that copy, kept as a pure,
 * table-driven function so it is exhaustive over `PartialRedemptionPolicy`
 * and a new policy added to the contract fails this file to compile
 * (docs/13b-typescript-standards.md §4's exhaustiveness discipline).
 *
 * YT-0405: takes an optional `locale`, defaulting to `id-ID` so existing
 * callers are unaffected, and reads its copy from the `store` message
 * catalogue via `store-i18n.ts`.
 */
export function partialRedemptionPolicyLabel(
  policy: PartialRedemptionPolicy,
  locale: SupportedLocale = "id-ID",
): string {
  const t = getStoreTranslator(locale);
  switch (policy) {
    case "balance_carrying":
      return t("redemption.balanceCarrying");
    case "single_use_forfeit":
      return t("redemption.singleUseForfeit");
    case "minimum_spend":
      return t("redemption.minimumSpend");
    default: {
      const exhaustive: never = policy;
      throw new Error(`Unhandled partial redemption policy: ${String(exhaustive)}`);
    }
  }
}

/**
 * The full sentence explaining what happens when an order is less than the
 * voucher's face value (docs/09 §8.2's three behaviours: "a gift card" /
 * "a coupon" / "a promo code"). `minimumSpendIdr` is required exactly when
 * `policy` is `"minimum_spend"` — enforced by the contract's own refine
 * (`listing.ts`) — so it is only read in that branch.
 *
 * YT-0405: the minimum-spend amount is rendered via `formatMoney`, never a
 * hardcoded `formatIdr` — an `en-AU` caller passing `currency: "AUD"` sees
 * `$75.00`, never `Rp75.000`. `minimumSpendIdr`'s name is a legacy of the
 * IDR-only original signature (YT-0506 has not settled the stored money
 * type); it is still the raw minor-unit amount, now formatted in whichever
 * currency the caller passes.
 */
export function partialRedemptionPolicyDescription(
  policy: PartialRedemptionPolicy,
  minimumSpendIdr: IdrMinorUnits | null,
  locale: SupportedLocale = "id-ID",
  currency: SupportedCurrency = "IDR",
): string {
  const t = getStoreTranslator(locale);
  switch (policy) {
    case "balance_carrying":
      return t("redemption.descBalanceCarrying");
    case "single_use_forfeit":
      return t("redemption.descSingleUseForfeit");
    case "minimum_spend":
      return minimumSpendIdr
        ? t("redemption.descMinimumSpendWithAmount", {
            amount: formatMoney(minimumSpendIdr, currency),
          })
        : t("redemption.descMinimumSpendUnspecified");
    default: {
      const exhaustive: never = policy;
      throw new Error(`Unhandled partial redemption policy: ${String(exhaustive)}`);
    }
  }
}

/**
 * Transferability copy (docs/09 §7: one-hop, verified-recipient transfer,
 * "shown to the user before they spend points"). Deliberately never says
 * more than one hop is possible — the doc is explicit that overselling
 * transfer as free trading is a compliance risk (§7.1), not just a copy
 * nuance.
 */
export function transferabilityDescription(
  transferable: boolean,
  locale: SupportedLocale = "id-ID",
): string {
  const t = getStoreTranslator(locale);
  return transferable ? t("redemption.transferable") : t("redemption.notTransferable");
}
