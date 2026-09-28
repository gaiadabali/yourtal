import { z } from "zod";

/**
 * TASKS.md 1.2.b/8.3.f: the merchant HMAC credential a brand's server (or,
 * explicitly, one of a merchant's own terminals) signs requests with.
 *
 * `deviceId` is OPTIONAL and, left out, means an ordinary merchant-wide
 * credential — the kind void and refund need
 * (services/voucher/internal/redeem/routes_release.go's
 * `refuseDevicePrincipal` only ever allows one with no device). Before
 * 8.3.f this field was required, and Studio's own issuance use-case filled
 * it with the credential's label as a workaround — so every credential
 * Studio ever issued was refused on void/refund. Set it only for the
 * deliberate, explicit case of a merchant attributing authorizations to one
 * of their own terminals (settle.go's `place()`); no caller does that
 * today.
 */
export const issueMerchantCredentialRequestSchema = z.object({
  merchantId: z.uuid(),
  deviceId: z.string().min(1).optional(),
  issuedBy: z.string().min(1),
});
export type IssueMerchantCredentialRequest = z.infer<typeof issueMerchantCredentialRequestSchema>;

export const merchantCredentialSchema = z.object({
  credentialId: z.string().min(1),
  merchantId: z.uuid(),
  /** Absent for the ordinary merchant-wide credential — see this file's own header. */
  deviceId: z.string().min(1).optional(),
  /** Only ever returned once, at issuance or rotation — never on a later read. */
  secret: z.string().min(1).optional(),
  state: z.enum(["active", "revoked"]),
  issuedAt: z.iso.datetime(),
});
export type MerchantCredential = z.infer<typeof merchantCredentialSchema>;

export const rotateCredentialRequestSchema = z.object({
  credentialId: z.string().min(1),
  rotatedBy: z.string().min(1),
});
export type RotateCredentialRequest = z.infer<typeof rotateCredentialRequestSchema>;

export const revokeCredentialRequestSchema = z.object({
  credentialId: z.string().min(1),
  revokedBy: z.string().min(1),
});
export type RevokeCredentialRequest = z.infer<typeof revokeCredentialRequestSchema>;
