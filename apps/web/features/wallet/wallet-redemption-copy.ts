import type { Translator } from "./wallet-voucher-status-copy";

/** The partial-redemption policies a voucher can carry (`@yourtal/contracts/listing/listing`). */
export type PartialRedemptionPolicy = "balance_carrying" | "single_use_forfeit" | "minimum_spend";

/**
 * Plain-language explanation of a voucher's partial-redemption policy
 * (docs/09-points-economy-and-redemption.md §8.2). Takes the caller's own
 * translator — see `wallet-voucher-status-copy.ts`'s `Translator` doc
 * comment for why this is shared between a Server and a Client caller
 * instead of each holding its own locale-keyed copy.
 */
export function describePartialRedemptionPolicy(
  policy: PartialRedemptionPolicy,
  t: Translator,
): string {
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
  policy: PartialRedemptionPolicy,
  t: Translator,
): string {
  const policyLine = describePartialRedemptionPolicy(policy, t);
  return t("redemption.instructions", { merchantName, policyLine });
}
