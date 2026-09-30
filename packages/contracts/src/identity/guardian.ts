import * as z from "zod";
import { regionSchema } from "../region/region";
import { pointsSchema } from "../money/money";
import { displayLocaleSchema } from "./user-profile";

/**
 * The guardian consent flow (TASKS.md 12.1.a/12.2.c). Three public,
 * no-session routes — `GET/POST /api/guardian/:token[/approve|/revoke]` —
 * fronting `identity.guardian_consent`. The token IS the credential (there
 * is no guardian account), the same shape `device.ts`'s pairing code is for
 * a counter device.
 */

export const guardianConsentStatusSchema = z.enum(["pending", "granted", "revoked"]);
export type GuardianConsentStatus = z.infer<typeof guardianConsentStatusSchema>;

/**
 * `GET /api/guardian/:token`'s response. Deliberately narrow: no date of
 * birth and no email address anywhere in this shape (12.1.a's own
 * instruction) — just enough for the guardian-facing page (12.2.c) to
 * greet the teen by name and show the right language/copy.
 */
export const guardianConsentViewSchema = z.object({
  status: guardianConsentStatusSchema,
  displayName: z.string().min(1).max(120),
  region: regionSchema,
  locale: displayLocaleSchema,
});
export type GuardianConsentView = z.infer<typeof guardianConsentViewSchema>;

/**
 * `POST /api/guardian/:token/approve`'s body. `confirmAdult` must be the
 * literal `true` — anything else (including `false` or the field missing)
 * is a 400, not a domain refusal: there is no partial or "maybe" approval.
 */
export const approveGuardianConsentRequestSchema = z.object({
  confirmAdult: z.literal(true),
});
export type ApproveGuardianConsentRequest = z.infer<typeof approveGuardianConsentRequestSchema>;

export const approveGuardianConsentResultSchema = z.object({ approved: z.literal(true) });
export type ApproveGuardianConsentResult = z.infer<typeof approveGuardianConsentResultSchema>;

/**
 * `POST /api/guardian/:token/revoke`'s response. `escrowedPoints` is
 * `toPoints(0)` when the account already had nothing to protect, or when
 * this call found the link already revoked (idempotent no-op — nothing
 * escrowed a second time).
 */
export const revokeGuardianConsentResultSchema = z.object({
  revoked: z.literal(true),
  escrowedPoints: pointsSchema,
});
export type RevokeGuardianConsentResult = z.infer<typeof revokeGuardianConsentResultSchema>;

/**
 * `POST /api/guardian/:token/delete-account`'s body (12.4.b #6). Same
 * "literal true, not a boolean" shape as `approveGuardianConsentRequestSchema`
 * above — there is no partial or "maybe" deletion, and `false`/missing is a
 * 400, not a domain refusal.
 */
export const deleteGuardianAccountRequestSchema = z.object({
  confirm: z.literal(true),
});
export type DeleteGuardianAccountRequest = z.infer<typeof deleteGuardianAccountRequestSchema>;

/**
 * Deliberately as narrow as `approveGuardianConsentResultSchema` — the
 * teen's own `DELETE /api/me` returns a full `DeletionReport`
 * (per-domain erased/anonymised/retained/unhandled), which is exactly the
 * kind of operational detail (which domains are still unhandled) this
 * public, no-session route must not hand a caller with nothing but a
 * token. `deleted: true` is the whole answer a guardian needs.
 */
export const deleteGuardianAccountResultSchema = z.object({ deleted: z.literal(true) });
export type DeleteGuardianAccountResult = z.infer<typeof deleteGuardianAccountResultSchema>;
