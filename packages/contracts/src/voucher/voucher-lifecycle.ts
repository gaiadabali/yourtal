import { z } from "zod";
import { voucherStatusSchema, type VoucherStatus } from "./voucher";

/**
 * A voucher's internal lifecycle. YT-0142.
 *
 * ## Two enums, one deriving from the other
 *
 * `voucherSchema.status` is `active | redeemed | expired | transferred` —
 * what a **wallet** shows. It has no way to say "minted but allocated to
 * nobody" or "an authorization is outstanding against this", and it should
 * not: neither is a fact a user can hold an opinion about.
 *
 * This enum is the state the voucher service stores and moves. It is
 * exactly the shape YT-0101 settled for campaigns — store the real state,
 * derive the public one, never store both — and the reasoning carries over
 * unchanged: two stored copies of one fact is a pair that can disagree, and
 * the copy is what goes stale.
 *
 * ## The public form cannot represent an internal state
 *
 * `publicVoucherStatusOf` returns `undefined` for every state with no public
 * form, and the API turns that into a **404 identical to the one a
 * nonexistent id gets**. Not a 403, and not a voucher rendered in some
 * neutral state — both of those confirm the id exists, which is a free
 * oracle for anybody walking the id space.
 *
 * The direction of the conversion matters too. The public type simply cannot
 * carry `held` or `minted`, so converting DROPS them; there is no validation
 * step that throws at the boundary. That is deliberate, and it is the same
 * lesson `presented-question.ts` learned the hard way: **stripping cannot
 * fail open, rejecting can** — a throw in a response path invites a `catch`
 * that returns the unconverted object, internal state and all.
 *
 * ## Why `voided` needs a reason to become a status
 *
 * A voucher voided by TRANSFER became somebody else's and its value still
 * exists (docs/09 §7's void-and-remint). One voided for fraud did not. The
 * wallet must show those differently, and a user asking "where did my
 * voucher go" deserves the true answer — so the reason is an input to the
 * derivation rather than a footnote on it.
 */
export const VOUCHER_LIFECYCLE_STATES = [
  "minted",
  "allocated",
  "active",
  "held",
  "redeemed",
  "expired",
  "voided",
] as const;

export const voucherLifecycleStateSchema = z.enum(VOUCHER_LIFECYCLE_STATES);
export type VoucherLifecycleState = z.infer<typeof voucherLifecycleStateSchema>;

export const VOUCHER_VOID_REASONS = ["transfer", "fraud", "refund_reversal", "admin"] as const;

export const voucherVoidReasonSchema = z.enum(VOUCHER_VOID_REASONS);
export type VoucherVoidReason = z.infer<typeof voucherVoidReasonSchema>;

/**
 * Every legal move. A state's absence from a list is a refusal.
 *
 * This table is the TypeScript half of a rule that is also enforced in Go
 * (`services/voucher/internal/lifecycle`) and in Postgres. Three copies
 * sounds like two too many, and it is the deliberate shape docs/13 asks for:
 * the database is what actually holds, the service refuses early so a caller
 * gets a sentence instead of a constraint name, and this one exists so a
 * console can grey out a button it knows will fail. `voucher-lifecycle.test.ts`
 * asserts this table against a hand-written expectation, never against
 * itself.
 */
export const VOUCHER_LIFECYCLE_TRANSITIONS: Record<
  VoucherLifecycleState,
  readonly VoucherLifecycleState[]
> = {
  // Inventory. It can be claimed, killed, or reach its expiry unsold.
  minted: ["allocated", "voided", "expired"],
  // Allocation is undone by voiding, never by returning to `minted`: a
  // voucher that could silently rejoin inventory is one the redemption
  // saga's compensation could hand to a second user.
  allocated: ["active", "voided", "expired"],
  active: ["held", "redeemed", "expired", "voided"],
  // A hold ends in exactly three ways: captured, released back to active
  // (voided or the hold's TTL passing), or the voucher killed under it —
  // a kill switch must not have to wait for somebody's abandoned cart.
  held: ["active", "redeemed", "voided"],
  // Terminal. A refund after full redemption mints a REPLACEMENT rather
  // than reviving this one, because a state write that can un-spend money
  // is not a state write anybody should be able to make.
  redeemed: [],
  // The one reversal that exists, and only inside a grace window — an
  // expiry job that ran against a wrong clock would otherwise be
  // unrecoverable for every voucher it touched.
  expired: ["active"],
  // Terminal, or the kill switch is advisory.
  voided: [],
};

export function canTransition(from: VoucherLifecycleState, to: VoucherLifecycleState): boolean {
  return VOUCHER_LIFECYCLE_TRANSITIONS[from].some((allowed) => allowed === to);
}

/**
 * The wallet-facing status for an internal state, or `undefined` when the
 * voucher has no public form at all.
 *
 * `held` maps to `active` on purpose. A hold is a fact about a checkout in
 * progress, not about the user's ownership — showing it would mean a wallet
 * flickering into an unexplained state while a cashier finishes typing.
 */
export function publicVoucherStatusOf(
  state: VoucherLifecycleState,
  voidReason: VoucherVoidReason | null,
): VoucherStatus | undefined {
  switch (state) {
    case "active":
    case "held":
      return "active";
    case "redeemed":
      return "redeemed";
    case "expired":
      return "expired";
    case "voided":
      // Only a transfer leaves the user with something true to be told.
      return voidReason === "transfer" ? "transferred" : undefined;
    case "minted":
    case "allocated":
      return undefined;
  }
}

/**
 * Whether a voucher is visible to its owner at all.
 *
 * The API gates on this and returns a 404 when it is false — the same 404 a
 * nonexistent id gets. See the note at the top on why distinguishing them
 * would be a disclosure.
 */
export function isVisibleToOwner(
  state: VoucherLifecycleState,
  voidReason: VoucherVoidReason | null,
): boolean {
  return publicVoucherStatusOf(state, voidReason) !== undefined;
}

/** Every public status must be reachable; guarded by the lifecycle test. */
export const PUBLIC_VOUCHER_STATUSES = voucherStatusSchema.options;
