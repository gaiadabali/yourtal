import type { Voucher } from "@yourtal/contracts/voucher";

/**
 * Plain-language explanation of a voucher's partial-redemption policy
 * (docs/09-points-economy-and-redemption.md §8.2), in Indonesian. Type-only
 * import from `@yourtal/contracts/voucher`, so this is safe from a client
 * leaf as well as a Server Component.
 */
export function describePartialRedemptionPolicy(policy: Voucher["partialRedemptionPolicy"]): string {
  switch (policy) {
    case "balance_carrying":
      return "Kalau belanjamu kurang dari nilai voucher, sisanya tetap tersimpan untuk dipakai lain kali.";
    case "single_use_forfeit":
      return "Voucher ini sekali pakai — kalau belanjamu kurang dari nilai voucher, sisanya hangus dan tidak bisa dipakai lagi.";
    case "minimum_spend":
      return "Voucher ini hanya bisa dipakai kalau belanjamu mencapai jumlah minimum yang ditentukan merchant.";
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
export function buildRedemptionInstructions(merchantName: string, policy: Voucher["partialRedemptionPolicy"]): string {
  const policyLine = describePartialRedemptionPolicy(policy);
  return `Tunjukkan kode QR ini ke kasir ${merchantName} saat membayar, atau sebutkan kode vouchernya kalau diminta secara manual. ${policyLine}`;
}
