import { z } from "zod";

/**
 * Basic KYB (Know Your Business) document types for onboarding an Indonesian
 * or Australian advertiser — YT-0100's acceptance criterion, not a general
 * document vault. `docs/17 section 5` puts KYB *review* under the internal
 * `ops` role. The `kyb_document` resource kind (YT-0507) already reserves
 * `approve`/`reject` for `ops`, with a policy-level DENY that stops a
 * business approving its own submission — but **the ops review queue
 * endpoint itself is not built**. The policy grant exists and nothing calls
 * it yet.
 *
 * Promoted from `apps/api/src/modules/business/domain/kyb-document.ts`
 * (YT-0100) into `@yourtal/contracts` (YT-0508) so the advertiser console
 * (YT-0440+) can share the shape instead of redefining it.
 */
export const kybDocumentTypeSchema = z.enum([
  "business_registration_certificate",
  "tax_registration_number",
  "director_identity",
  "proof_of_address",
]);
export type KybDocumentType = z.infer<typeof kybDocumentTypeSchema>;

export const kybDocumentStatusSchema = z.enum(["submitted", "verified", "rejected", "expired"]);
export type KybDocumentStatus = z.infer<typeof kybDocumentStatusSchema>;

/**
 * `storageRef` is an opaque pointer to wherever the encrypted bytes live
 * (docs/15: R2 + Cloud KMS envelope encryption for PII). This module stores
 * and tracks the reference and its expiry only — it does not implement the
 * encrypted upload path itself, which belongs with the signed-upload work
 * in YT-0110's family.
 */
export const kybDocumentSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  documentType: kybDocumentTypeSchema,
  storageRef: z.string().min(1),
  status: kybDocumentStatusSchema,
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  submittedAt: z.iso.datetime({ offset: true }),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
  verifiedByUserId: z.string().min(1).nullable(),
});

export type KybDocument = z.infer<typeof kybDocumentSchema>;
