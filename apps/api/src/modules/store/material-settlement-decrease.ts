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
 * listing's CURRENT `settlementValueMinor`, which is only known after a
 * repository read, so it cannot be produced there without either an async
 * `attrsFrom` (a change to `authorize.decorator.ts`/`pdp.guard.ts`, both
 * outside this module's path) or a second, explicit PDP call once the read
 * has happened. `StoreListingController.setSettlementValue` does the latter.
 *
 * ## There is no threshold, and that is a decision (YT-0576)
 *
 * **Any downward change to `S` needs two-person approval. No threshold.**
 * Founder decision, 2026-09-21, recorded by the economy-epic session and
 * confirmed directly.
 *
 * This replaces `MATERIAL_SETTLEMENT_DECREASE_THRESHOLD = 0.2`, which was
 * never a decision. docs/17 section 2.1 says "downward by more than a
 * threshold" and names no number; nothing in `docs/`, `policies/_schemas/`
 * or `policies/tests/` named one either. Twenty percent was invented here so
 * the control would not be silently disabled, and flagged as a placeholder
 * in its own doc comment. **It was removed rather than ratified.**
 *
 * Why no number is the safer answer rather than a lazy one: a threshold
 * creates a band, below the line, in which a settlement cut applies with one
 * pair of hands — and it is reachable repeatedly. Two 15% cuts under a 20%
 * threshold take `S` down 27.75% with nobody approving anything, so the
 * control is not merely weakened by a small threshold, it is **bypassable by
 * anyone willing to make two calls.** Defeating a no-threshold rule requires
 * defeating the approval workflow itself, which is the thing that was
 * actually designed. The cost is that trivial corrections now need a second
 * pair of eyes; the founder took that trade knowingly.
 *
 * The name keeps the word "material" because
 * `R.attr.isMaterialSettlementDecrease` is the attribute name
 * `listing.yaml` reads and `two_person_approval_test.yaml` asserts on.
 * Renaming it here would be a policy change wearing a refactor's clothes.
 */
export function isMaterialSettlementDecrease(
  currentSettlementValueMinor: number,
  proposedSettlementValueMinor: number,
): boolean {
  return proposedSettlementValueMinor < currentSettlementValueMinor;
}
