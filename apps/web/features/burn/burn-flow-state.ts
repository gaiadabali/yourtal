import type { BurnError } from "./burn-errors";

/**
 * The whole burn flow's state as a discriminated union on `step`
 * (docs/13b-typescript-standards.md section 4's pattern, applied to UI flow
 * state and not just to errors). Every render in `burn-flow.tsx` is exactly
 * one of these five shapes — never an ad hoc combination of booleans
 * (`isSubmitting`, `hasSucceeded`, `errorMessage`) that could contradict
 * each other, e.g. "submitting" and "showing a success voucher" both true
 * at once.
 *
 * 11.6.b: `success` carries only `voucherId` — `POST /api/checkout`'s real
 * response (`CheckoutResult`). The merchant name and title it used to carry
 * (`BurnVoucherSummary`, a mock-era display stand-in) are read straight off
 * the `listing` prop `BurnFlow` already has in scope; there is no second
 * copy to keep in sync.
 */
export type BurnFlowState =
  | { step: "reviewing" }
  | { step: "confirming" }
  | { step: "submitting" }
  | { step: "success"; voucherId: string }
  | { step: "failed"; error: BurnError };
