import { describe, expect, it } from "vitest";
import {
  PUBLIC_VOUCHER_STATUSES,
  VOUCHER_LIFECYCLE_STATES,
  VOUCHER_LIFECYCLE_TRANSITIONS,
  VOUCHER_VOID_REASONS,
  canTransition,
  isVisibleToOwner,
  publicVoucherStatusOf,
  type VoucherLifecycleState,
  type VoucherVoidReason,
} from "./voucher-lifecycle";
import { voucherStatusSchema } from "./voucher";

/**
 * The expectation below is written out by hand rather than derived from
 * `VOUCHER_LIFECYCLE_TRANSITIONS`.
 *
 * A test that loops over the table it is testing asserts that the table
 * equals itself — the same defect `openapi:go:check` has, comparing a
 * generator's output to its own input. Only a second, independent statement
 * of the rules can disagree with the first.
 */
const LEGAL: ReadonlySet<string> = new Set([
  "minted->allocated",
  "minted->voided",
  "minted->expired",

  "allocated->active",
  "allocated->voided",
  "allocated->expired",

  "active->held",
  "active->redeemed",
  "active->expired",
  "active->voided",

  "held->active",
  "held->redeemed",
  "held->voided",

  "expired->active",
]);

describe("the voucher transition table", () => {
  it("permits exactly the moves that are legal, and refuses every other pair", () => {
    for (const from of VOUCHER_LIFECYCLE_STATES) {
      for (const to of VOUCHER_LIFECYCLE_STATES) {
        expect(
          canTransition(from, to),
          `${from} -> ${to} disagrees with the hand-written expectation`,
        ).toBe(LEGAL.has(`${from}->${to}`));
      }
    }
  });

  // The two rules that would each be a real incident rather than a bug.
  it("makes redeemed and voided terminal", () => {
    for (const terminal of ["redeemed", "voided"] as const) {
      expect(VOUCHER_LIFECYCLE_TRANSITIONS[terminal]).toHaveLength(0);
      for (const to of VOUCHER_LIFECYCLE_STATES) {
        expect(canTransition(terminal, to), `${terminal} -> ${to} is permitted`).toBe(false);
      }
    }
  });

  it("gives every state a row, so no state is accidentally terminal", () => {
    for (const state of VOUCHER_LIFECYCLE_STATES) {
      expect(VOUCHER_LIFECYCLE_TRANSITIONS[state], `${state} has no row`).toBeDefined();
    }
    expect(Object.keys(VOUCHER_LIFECYCLE_TRANSITIONS)).toHaveLength(
      VOUCHER_LIFECYCLE_STATES.length,
    );
  });
});

describe("the public status derivation", () => {
  it("maps each internal state to what a wallet should show", () => {
    const expected: Record<VoucherLifecycleState, string | undefined> = {
      minted: undefined,
      allocated: undefined,
      active: "active",
      // A hold is a fact about a checkout in progress, not about ownership.
      held: "active",
      redeemed: "redeemed",
      expired: "expired",
      voided: undefined,
    };

    for (const state of VOUCHER_LIFECYCLE_STATES) {
      expect(publicVoucherStatusOf(state, null), `${state}`).toBe(expected[state]);
    }
  });

  it("shows a transferred voucher as transferred, and every other void as nothing at all", () => {
    const shown: Record<VoucherVoidReason, string | undefined> = {
      transfer: "transferred",
      fraud: undefined,
      refund_reversal: undefined,
      admin: undefined,
    };

    for (const reason of VOUCHER_VOID_REASONS) {
      expect(publicVoucherStatusOf("voided", reason), reason).toBe(shown[reason]);
    }
  });

  /**
   * The property yourtal-14 asked for, stated as a test rather than as a
   * convention: a voucher with no public form must be indistinguishable
   * from one that does not exist.
   *
   * Every state with no public status must also be invisible, so a route
   * that gates on `isVisibleToOwner` cannot render one. The failure this
   * prevents is a 403 or a neutral rendering, either of which confirms the
   * id exists — a free oracle for anybody walking the id space.
   */
  it("makes every state with no public form invisible to its owner", () => {
    for (const state of VOUCHER_LIFECYCLE_STATES) {
      for (const reason of [null, ...VOUCHER_VOID_REASONS]) {
        const status = publicVoucherStatusOf(state, reason);
        expect(
          isVisibleToOwner(state, reason),
          `${state}/${reason ?? "no reason"}: visibility and status disagree`,
        ).toBe(status !== undefined);
      }
    }
  });

  /**
   * The public type must be UNABLE to carry an internal state — not merely
   * validated against carrying one.
   *
   * `presented-question.ts` reached the same fork and recorded the reason:
   * stripping cannot fail open, rejecting can, because a throw in a response
   * path invites a `catch` that returns the unconverted object. So the check
   * here is that the public enum has no member named after an internal-only
   * state, which makes the leak unrepresentable rather than caught.
   */
  it("has no public status able to name an internal-only state", () => {
    for (const internalOnly of ["minted", "allocated", "held"] as const) {
      expect(
        voucherStatusSchema.safeParse(internalOnly).success,
        `voucherStatusSchema accepts ${internalOnly}, so the internal state can leak into a wallet`,
      ).toBe(false);
    }
  });

  it("can reach every public status from some internal state", () => {
    const reachable = new Set<string>();
    for (const state of VOUCHER_LIFECYCLE_STATES) {
      for (const reason of [null, ...VOUCHER_VOID_REASONS]) {
        const status = publicVoucherStatusOf(state, reason);
        if (status !== undefined) reachable.add(status);
      }
    }

    // A public status nothing can produce is a value every consumer has to
    // handle and no voucher will ever have.
    for (const status of PUBLIC_VOUCHER_STATUSES) {
      expect(reachable.has(status), `no internal state produces "${status}"`).toBe(true);
    }
  });
});
