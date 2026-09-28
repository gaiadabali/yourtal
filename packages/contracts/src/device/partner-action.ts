import { z } from "zod";

/**
 * TASKS.md 8.4.a: `POST /api/partners/actions` — snap-app's receipt-scan
 * integration. Partner-HMAC authenticated only (no session); `user` names
 * the account through the 5.4.c link code, never a raw platform user id a
 * caller could name for itself.
 */

export const partnerActionTypeSchema = z.enum(["receipt_scanned"]);
export type PartnerActionType = z.infer<typeof partnerActionTypeSchema>;

export const partnerActionRequestSchema = z.object({
  /** The 5.4.c link code, not a `userId` — see `me.create_link_code`. */
  user: z.string().min(1),
  action: partnerActionTypeSchema,
  /** The receipt's own reference from the partner's system. */
  externalRef: z.string().min(1),
  /** Opaque, partner-defined evidence (a photo ref, an OCR summary) — never parsed here. */
  evidence: z.record(z.string(), z.unknown()).default({}),
});
export type PartnerActionRequest = z.infer<typeof partnerActionRequestSchema>;

export const partnerActionResultSchema = z.object({
  granted: z.boolean(),
  /** Points, not money — there is no minor-unit concept for the platform's own points (money.ts's `pointsSchema`). */
  points: z.number().int().min(0),
});
export type PartnerActionResult = z.infer<typeof partnerActionResultSchema>;
