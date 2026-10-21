import * as z from "zod";

/**
 * TASKS.md 8.4.a, 14.3: `POST /api/partners/actions` — a partner app's
 * receipt-scan integration (SnapApp first). Partner-HMAC authenticated only
 * (no session). The account is named by a link, never a raw platform user id
 * a caller could choose: either the user's one-time link code (`user`, the
 * first call, which creates the link) or the lasting `linkId` that call
 * returned. Exactly one of the two.
 */

export const partnerActionTypeSchema = z.enum(["receipt_scanned"]);
export type PartnerActionType = z.infer<typeof partnerActionTypeSchema>;

export const partnerActionRequestSchema = z
  .object({
    /** The user's one-time link code (5.4.c). Creates the link; send `linkId` from then on. */
    user: z.string().min(1).optional(),
    /** The lasting link id a previous call returned (14.3.b). */
    linkId: z.uuid().optional(),
    action: partnerActionTypeSchema,
    /** The receipt's own hash in the partner's system; one payout per (partner, externalRef). */
    externalRef: z.string().min(1),
    /** Opaque, partner-defined evidence (a photo ref, an OCR summary) — never parsed here. */
    evidence: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((body) => (body.user === undefined) !== (body.linkId === undefined), {
    message: "send exactly one of `user` (a link code) or `linkId`",
    path: ["linkId"],
  });
export type PartnerActionRequest = z.infer<typeof partnerActionRequestSchema>;

export const partnerActionResultSchema = z.object({
  /** True when this receipt has earned points for the linked account (now or on an earlier call). */
  granted: z.boolean(),
  /** Points, not money — there is no minor-unit concept for the platform's own points (money.ts's `pointsSchema`). */
  points: z.number().int().min(0),
  /** The lasting link to send as `linkId` on later calls. */
  linkId: z.uuid(),
  /** True when this receipt was already reported: nothing new was paid by this call. */
  duplicate: z.boolean(),
});
export type PartnerActionResult = z.infer<typeof partnerActionResultSchema>;

/** 14.3.b: `POST /api/partners/links` — exchange a link code for a lasting link, without a receipt. */
export const partnerLinkRequestSchema = z.object({
  /** The user's one-time link code (5.4.c), shown in YourTal under Me → Linked apps. */
  code: z.string().min(1),
});
export type PartnerLinkRequest = z.infer<typeof partnerLinkRequestSchema>;

export const partnerLinkResultSchema = z.object({
  linkId: z.uuid(),
  /** The account's region: AU earns in AU points, ID in ID points. */
  region: z.enum(["AU", "ID"]),
  createdAt: z.iso.datetime(),
});
export type PartnerLinkResult = z.infer<typeof partnerLinkResultSchema>;

/**
 * `POST /api/partners/links/{linkId}/revoke` — the partner ends a link (its
 * user left the partner app). Revoking an already-revoked link answers the
 * same way, with the original `revokedAt`.
 */
export const partnerLinkRevokeResultSchema = z.object({
  linkId: z.uuid(),
  revokedAt: z.iso.datetime(),
});
export type PartnerLinkRevokeResult = z.infer<typeof partnerLinkRevokeResultSchema>;

/**
 * 2.10.b (F127): `POST /api/partners/receipts/status` -- a partner polls
 * whether its receipt points are being paid (YourTal has no outbound partner
 * channel). Partner-HMAC authenticated, not value-moving.
 */
export const partnerReceiptStatusRequestSchema = z.object({
  region: z.enum(["AU", "ID"]),
});
export type PartnerReceiptStatusRequest = z.infer<typeof partnerReceiptStatusRequestSchema>;

export const partnerReceiptStatusResultSchema = z.object({
  region: z.enum(["AU", "ID"]),
  /** True when a receipt package has room for one receipt. */
  earning: z.boolean(),
  /** Points paid per receipt: 1 in AU, 10 in ID. */
  pointsPerReceipt: z.number().int().min(0),
  /** Points left across the funder's receipt packages. */
  remainingPoints: z.number().int().min(0),
});
export type PartnerReceiptStatusResult = z.infer<typeof partnerReceiptStatusResultSchema>;
