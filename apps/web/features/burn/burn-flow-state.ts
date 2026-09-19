import type { BurnError } from "./burn-errors";
import type { BurnVoucherSummary } from "./burn-redemption";

/**
 * The whole burn flow's state as a discriminated union on `step`
 * (docs/13b-typescript-standards.md section 4's pattern, applied to UI flow
 * state and not just to errors, per docs/tasks/phase-u-ui.md YT-0422). Every
 * render in `burn-flow.tsx` is exactly one of these five shapes — never an
 * ad hoc combination of booleans (`isSubmitting`, `hasSucceeded`,
 * `errorMessage`) that could contradict each other, e.g. "submitting" and
 * "showing a success voucher" both true at once.
 */
export type BurnFlowState =
  | { step: "reviewing" }
  | { step: "confirming" }
  | { step: "submitting" }
  | { step: "success"; voucher: BurnVoucherSummary }
  | { step: "failed"; error: BurnError };
