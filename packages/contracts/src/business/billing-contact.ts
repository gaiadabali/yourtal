import { z } from "zod";

/** E.164: leading `+`, no leading zero, 7-15 digits total. */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * The person a business's invoices and settlement statements are sent to
 * (docs/17 section 2, Billing zone). One per business — a business with no
 * billing contact set yet simply has no row, which is a service-layer
 * concern, not something this schema represents.
 *
 * Promoted from `apps/api/src/modules/business/domain/billing-contact.ts`
 * (YT-0100) into `@yourtal/contracts` (YT-0508) so the advertiser console
 * (YT-0440+) can share the shape instead of redefining it.
 */
export const billingContactSchema = z.object({
  businessId: z.uuid(),
  name: z.string().min(1).max(160),
  email: z.email(),
  phone: z.string().regex(E164_PATTERN, "phone must be E.164, e.g. +6281234567890"),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type BillingContact = z.infer<typeof billingContactSchema>;
