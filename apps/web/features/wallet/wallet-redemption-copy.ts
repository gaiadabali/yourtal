import type { Voucher } from "@yourtal/contracts/voucher";
import { getWalletTranslator, type SupportedLocale } from "./wallet-i18n";

/**
 * Plain-language explanation of a voucher's partial-redemption policy
 * (docs/09-points-economy-and-redemption.md §8.2). Type-only import from
 * `@yourtal/contracts/voucher`, so this is safe from a client leaf as well
 * as a Server Component.
 *
 * YT-0405: `locale` is required, not defaulted. Its one call site,
 * `app/(app)/wallet/voucher/[voucherId]/page.tsx`, now resolves the real
 * region via `getRegionDisplayConfig()` and passes it through.
 */
export function describePartialRedemptionPolicy(
  policy: Voucher["partialRedemptionPolicy"],
  locale: SupportedLocale,
): string {
  const t = getWalletTranslator(locale);
  switch (policy) {
    case "balance_carrying":
      return t("redemption.balanceCarrying");
    case "single_use_forfeit":
      return t("redemption.singleUseForfeit");
    case "minimum_spend":
      return t("redemption.minimumSpend");
    default: {
      const exhaustiveCheck: never = policy;
      return exhaustiveCheck;
    }
  }
}

/**
 * Per-merchant redemption instructions in the user's language (YT-0424).
 * Names the actual merchant and folds in the batch's real
 * partial-redemption policy, rather than one generic paragraph for every
 * voucher regardless of who issued it.
 */
export function buildRedemptionInstructions(
  merchantName: string,
  policy: Voucher["partialRedemptionPolicy"],
  locale: SupportedLocale,
): string {
  const policyLine = describePartialRedemptionPolicy(policy, locale);
  return getWalletTranslator(locale)("redemption.instructions", { merchantName, policyLine });
}
