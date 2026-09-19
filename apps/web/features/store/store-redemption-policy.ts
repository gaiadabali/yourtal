import type { IdrMinorUnits } from "@yourtal/contracts/money";
import type { PartialRedemptionPolicy } from "@yourtal/contracts/listing";
import { formatIdr } from "@yourtal/contracts/money/format";

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
 */
export function partialRedemptionPolicyLabel(policy: PartialRedemptionPolicy): string {
  switch (policy) {
    case "balance_carrying":
      return "Sisa saldo tersimpan";
    case "single_use_forfeit":
      return "Sekali pakai, sisa hangus";
    case "minimum_spend":
      return "Ada minimum belanja";
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
 */
export function partialRedemptionPolicyDescription(policy: PartialRedemptionPolicy, minimumSpendIdr: IdrMinorUnits | null): string {
  switch (policy) {
    case "balance_carrying":
      return "Jika belanjamu kurang dari nilai voucher, sisa saldonya tetap tersimpan dan bisa dipakai lagi — seperti kartu hadiah.";
    case "single_use_forfeit":
      return "Voucher ini sekali pakai. Jika belanjamu kurang dari nilai voucher, sisa nilainya hangus setelah dipakai.";
    case "minimum_spend":
      return `Voucher ini hanya berlaku untuk belanja minimal ${minimumSpendIdr ? formatIdr(minimumSpendIdr) : "tertentu"}.`;
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
export function transferabilityDescription(transferable: boolean): string {
  return transferable
    ? "Voucher ini bisa dialihkan ke satu pengguna YourTal lain yang sudah terverifikasi."
    : "Voucher ini tidak bisa dialihkan ke pengguna lain.";
}
