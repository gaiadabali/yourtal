/**
 * `isMaterialSettlementDecrease` — the resource attribute
 * `policies/resource_policies/listing.yaml` and
 * `policies/_schemas/resource/listing.json` already define, and which
 * `policies/tests/two_person_approval_test.yaml` proves the PDP enforces:
 * a material cut to `S` is denied to EVERYONE through `set_settlement_value`
 * (owner included) and can only proceed as `approve_settlement_decrease`.
 *
 * ## Why this cannot be computed in `@Authorize`'s `attrsFrom`
 *
 * `attrsFrom` runs synchronously inside `PdpGuard`, against the request
 * alone (docs/17 section 2.1's other `attrsFrom` uses --
 * `targetRole`/`targetPrincipalId` on `team-member.controller.ts` -- are both
 * already-known request data for exactly this reason). Materiality needs the
 * listing's CURRENT `settlementValueIdr`, which is only known after a
 * repository read, so it cannot be produced there without either an async
 * `attrsFrom` (a change to `authorize.decorator.ts`/`pdp.guard.ts`, both
 * outside this module's path) or a second, explicit PDP call once the read
 * has happened. `StoreListingController.setSettlementValue` does the latter.
 *
 * ## The threshold is a PLACEHOLDER, not a decision
 *
 * docs/17 section 2.1 says "downward by more than a threshold" and names no
 * number. Nothing else in `docs/`, `policies/_schemas/` or `policies/tests/`
 * does either. Twenty percent is chosen so the safety check is not simply
 * disabled (see `store.module.ts`'s doc comment on why a control that never
 * fires is worse than an honest gap) but this number has NOT been confirmed
 * by anyone who owns docs/17 -- flagged explicitly in the ticket report.
 */
export const MATERIAL_SETTLEMENT_DECREASE_THRESHOLD = 0.2;

export function isMaterialSettlementDecrease(
  currentSettlementValueIdr: number,
  proposedSettlementValueIdr: number,
): boolean {
  if (proposedSettlementValueIdr >= currentSettlementValueIdr) return false;
  const decrease = currentSettlementValueIdr - proposedSettlementValueIdr;
  return decrease > currentSettlementValueIdr * MATERIAL_SETTLEMENT_DECREASE_THRESHOLD;
}
