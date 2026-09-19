import type { IdrMinorUnits } from "@yourtal/contracts/money";
import type { PartialRedemptionPolicy } from "@yourtal/contracts/listing";
import { Badge } from "@yourtal/ui/badge";
import { partialRedemptionPolicyDescription, partialRedemptionPolicyLabel, transferabilityDescription } from "./store-redemption-policy";

export interface StoreOfferTermsProps {
  partialRedemptionPolicy: PartialRedemptionPolicy;
  minimumSpendIdr: IdrMinorUnits | null;
  transferable: boolean;
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
export function StoreOfferTerms({ partialRedemptionPolicy, minimumSpendIdr, transferable }: StoreOfferTermsProps) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface px-3 py-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">Ketentuan</Badge>
        <span className="text-xs font-medium text-fg">{partialRedemptionPolicyLabel(partialRedemptionPolicy)}</span>
      </div>
      <p className="text-xs text-fg-muted">{partialRedemptionPolicyDescription(partialRedemptionPolicy, minimumSpendIdr)}</p>
      <p className="text-xs text-fg-muted">{transferabilityDescription(transferable)}</p>
    </div>
  );
}
