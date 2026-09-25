import { z } from "zod";

/** TASKS.md 1.2.b: the merchant-terminal credential a device authenticates with. */

export const issueMerchantCredentialRequestSchema = z.object({
  merchantId: z.uuid(),
  deviceId: z.string().min(1),
  issuedBy: z.string().min(1),
});
export type IssueMerchantCredentialRequest = z.infer<typeof issueMerchantCredentialRequestSchema>;

export const merchantCredentialSchema = z.object({
  credentialId: z.string().min(1),
  merchantId: z.uuid(),
  deviceId: z.string().min(1),
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
