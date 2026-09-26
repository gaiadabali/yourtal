import { z } from "zod";

/**
 * Dev/staging-only holdback control (TASKS.md 2.3.d/2.3.f's `/dev/clock`).
 * One operation for apps/api's two dev-clock actions: "release my pending
 * points now" sends `releaseNow`, "advance N days" sends `days`. Both the
 * fake (`platform.ledger_fake_grant`) and the live ledger
 * (`services/ledger/internal/api/dev_routes.go`) refuse this outside
 * dev/staging — this contract exists so both ends agree on the shape, not to
 * imply the operation is ever reachable in production.
 */
export const advanceHoldbackRequestSchema = z
  .object({
    userId: z.string().min(1),
    /** Bounded the same as apps/api's AdvanceDaysDto; required unless releaseNow. */
    days: z.number().int().min(1).max(3650).optional(),
    releaseNow: z.boolean().optional(),
  })
  .refine((value) => value.releaseNow === true || value.days !== undefined, {
    message: "either releaseNow or days is required",
  });
export type AdvanceHoldbackRequest = z.infer<typeof advanceHoldbackRequestSchema>;

/**
 * `shifted` is how many of the caller's still-pending grants a wait of that
 * length would have made due; `released` is how many were actually posted
 * (fewer than `shifted` exactly when `escrowHeld` is true — 4.4.g, a held
 * escrow keeps the rest pending).
 */
export const advanceHoldbackResultSchema = z.object({
  shifted: z.number().int().min(0),
  released: z.number().int().min(0),
  escrowHeld: z.boolean(),
});
export type AdvanceHoldbackResult = z.infer<typeof advanceHoldbackResultSchema>;
