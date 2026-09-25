import { z } from "zod";

/**
 * TASKS.md 1.2.b's reservation lifecycle: a voucher moves
 * minted -> reserved (against a saga) -> activated (owned) or released back
 * to the pool. See `../voucher/voucher-lifecycle.ts` for the full internal
 * state enum this operates over.
 */

export const reserveRequestSchema = z.object({
  listingId: z.uuid(),
  sagaId: z.string().min(1),
});
export type ReserveRequest = z.infer<typeof reserveRequestSchema>;

export const reservationSchema = z.object({
  voucherId: z.uuid(),
  listingId: z.uuid(),
  sagaId: z.string().min(1),
  state: z.enum(["reserved", "activated", "released"]),
});
export type Reservation = z.infer<typeof reservationSchema>;

export const releaseRequestSchema = z.object({ sagaId: z.string().min(1) });
export type ReleaseRequest = z.infer<typeof releaseRequestSchema>;

export const activateRequestSchema = z.object({
  sagaId: z.string().min(1),
  ownerId: z.uuid(),
});
export type ActivateRequest = z.infer<typeof activateRequestSchema>;

/** Owner-only. Never logged or cached — see `docs/15` rule 7 on plaintext codes. */
export const revealRequestSchema = z.object({
  voucherId: z.uuid(),
  ownerId: z.uuid(),
});
export type RevealRequest = z.infer<typeof revealRequestSchema>;

export const revealedCodeSchema = z.object({
  voucherId: z.uuid(),
  code: z.string().min(1),
});
export type RevealedCode = z.infer<typeof revealedCodeSchema>;

export const qrTokenRequestSchema = z.object({
  voucherId: z.uuid(),
  ownerId: z.uuid(),
});
export type QrTokenRequest = z.infer<typeof qrTokenRequestSchema>;

export const qrTokenSchema = z.object({
  token: z.string().min(1),
  voucherId: z.uuid(),
  expiresAt: z.iso.datetime(),
});
export type QrToken = z.infer<typeof qrTokenSchema>;

export const verifyQrTokenRequestSchema = z.object({ token: z.string().min(1) });
export type VerifyQrTokenRequest = z.infer<typeof verifyQrTokenRequestSchema>;

export const verifyQrTokenResultSchema = z.object({
  valid: z.boolean(),
  voucherId: z.uuid().nullable(),
});
export type VerifyQrTokenResult = z.infer<typeof verifyQrTokenResultSchema>;
