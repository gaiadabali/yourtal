import * as z from "zod";
import { kybDocumentSchema } from "../business/kyb-document";
import { taxIdKindSchema } from "../business/business";
import { regionSchema } from "../region/region";

/** TASKS.md 9.3.a: the staff console's Businesses zone. */

export const staffBusinessSummarySchema = z
  .object({
    id: z.uuid(),
    legalName: z.string().min(1),
    displayName: z.string().min(1),
    handle: z.string().min(1),
    region: regionSchema,
    isVerified: z.boolean(),
    suspendedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type StaffBusinessSummary = z.infer<typeof staffBusinessSummarySchema>;

/** 6.10.b: what the ABR said when staff last checked this business's ABN; `null` is "not checked". */
export const abnConfirmationSchema = z
  .object({
    abn: z.string(),
    entityName: z.string().min(1),
    gstRegistered: z.boolean(),
    confirmedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type AbnConfirmation = z.infer<typeof abnConfirmationSchema>;

export const staffBusinessDetailSchema = staffBusinessSummarySchema.extend({
  taxIdKind: taxIdKindSchema,
  taxIdValue: z.string().min(1),
  suspendedReason: z.string().nullable(),
  kybDocuments: z.array(kybDocumentSchema),
  abnConfirmation: abnConfirmationSchema.nullable(),
  /** True when the API has an `ABR_GUID`, so "Check with the ABR" can work. */
  abrLookupEnabled: z.boolean(),
});
export type StaffBusinessDetail = z.infer<typeof staffBusinessDetailSchema>;

export const listStaffBusinessesResponseSchema = z
  .object({
    businesses: z.array(staffBusinessSummarySchema),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ListStaffBusinessesResponse = z.infer<typeof listStaffBusinessesResponseSchema>;

const staffReasonSchema = z.object({ reason: z.string().min(1).max(500) });

export const approveBusinessKybRequestSchema = staffReasonSchema;
export type ApproveBusinessKybRequest = z.infer<typeof approveBusinessKybRequestSchema>;

export const rejectBusinessKybRequestSchema = staffReasonSchema;
export type RejectBusinessKybRequest = z.infer<typeof rejectBusinessKybRequestSchema>;

export const suspendBusinessRequestSchema = staffReasonSchema;
export type SuspendBusinessRequest = z.infer<typeof suspendBusinessRequestSchema>;

export const checkBusinessAbnRequestSchema = staffReasonSchema;
export type CheckBusinessAbnRequest = z.infer<typeof checkBusinessAbnRequestSchema>;

export const reinstateBusinessRequestSchema = staffReasonSchema;
export type ReinstateBusinessRequest = z.infer<typeof reinstateBusinessRequestSchema>;
