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

/** One of the 12 five-minute windows `qrtoken.Mint` produces (4.5.b). */
export const qrTokenWindowSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type QrTokenWindow = z.infer<typeof qrTokenWindowSchema>;

export const qrTokenSchema = z.object({
  token: z.string().min(1),
  voucherId: z.uuid(),
  expiresAt: z.iso.datetime(),
  /**
   * TASKS.md 4.8.c: all 12 windows the keyring already mints
   * (`services/voucher/internal/api/wallet_routes.go`'s `qrTokenView.Tokens`),
   * so a widened caller can cache the rest for offline display instead of
   * re-requesting one every 5 minutes. Optional: the fake client mints only
   * the current window (no keyring to mint 12 real ones against), so this
   * is absent there rather than a single-element lie.
   */
  tokens: z.array(qrTokenWindowSchema).optional(),
});
export type QrToken = z.infer<typeof qrTokenSchema>;

export const verifyQrTokenRequestSchema = z.object({ token: z.string().min(1) });
export type VerifyQrTokenRequest = z.infer<typeof verifyQrTokenRequestSchema>;

export const verifyQrTokenResultSchema = z.object({
  valid: z.boolean(),
  voucherId: z.uuid().nullable(),
});
export type VerifyQrTokenResult = z.infer<typeof verifyQrTokenResultSchema>;

/**
 * 4.7.c / K13 (requested by A): the owner disputes a voucher the merchant
 * would not honour, before it was ever captured. Legal only from `active`
 * (`Active -> Voided` is already in the lifecycle table) — a `held` or
 * `redeemed` voucher refuses with `already_granted`, the closest code in
 * the closed enum: a merchant transaction is already in flight or done, the
 * same "this already happened" shape that code names elsewhere. A voucher
 * already `voided` replays rather than refusing, so a retried call after a
 * lost response is safe.
 */
export const voidVoucherRequestSchema = z.object({
  voucherId: z.uuid(),
  ownerId: z.uuid(),
  reason: z.string().min(1),
});
export type VoidVoucherRequest = z.infer<typeof voidVoucherRequestSchema>;
