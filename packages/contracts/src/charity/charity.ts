import * as z from "zod";
import { regionSchema } from "../region/region";

/**
 * 13.21 (F86): the charity registry. A foundation applies, staff approve or
 * reject it, and only approved charities are listed. Auction proceeds go
 * straight to the charity's own payout account at the payment provider;
 * YourTal holds no charity balance (red line 8), so a charity carries a
 * provider payout reference and the last four digits, never an account
 * number.
 */
export const charityStateSchema = z.enum(["pending", "approved", "rejected"]);
export type CharityState = z.infer<typeof charityStateSchema>;

export const charityCauseSchema = z.enum([
  "children_youth",
  "education",
  "environment",
  "animals",
  "disaster_relief",
  "community",
  "arts_culture",
  "food_security",
]);
export type CharityCause = z.infer<typeof charityCauseSchema>;

/** AU: an ABN (11 digits) that is registered with the ACNC. */
export const auCharityRegistrationSchema = z.object({
  kind: z.literal("au_acnc"),
  abn: z.string().regex(/^\d{11}$/, "an ABN is 11 digits"),
  acncRegistered: z.literal(true),
});

/** ID: a yayasan's deed of establishment and its public fundraising permit. */
export const idCharityRegistrationSchema = z.object({
  kind: z.literal("id_yayasan"),
  deedNumber: z.string().min(3).max(60),
  fundraisingPermitNumber: z.string().min(3).max(60),
});

export const charityRegistrationSchema = z.discriminatedUnion("kind", [
  auCharityRegistrationSchema,
  idCharityRegistrationSchema,
]);
export type CharityRegistration = z.infer<typeof charityRegistrationSchema>;

/** The charity's own bank account, sent once to the simulated KYB check and never stored whole. */
export const charityPayoutAccountInputSchema = z.object({
  accountName: z.string().min(2).max(120),
  /** AU: the 6-digit BSB. ID: the bank's code. */
  bankCode: z.string().regex(/^\d{3,6}$/),
  accountNumber: z.string().regex(/^\d{6,20}$/),
});
export type CharityPayoutAccountInput = z.infer<typeof charityPayoutAccountInputSchema>;

/** `POST /api/charities/applications`: the region must match the registration's. */
export const charityApplicationRequestSchema = z
  .object({
    name: z.string().min(2).max(120),
    region: regionSchema,
    cause: charityCauseSchema,
    summary: z.string().min(10).max(500),
    logoUrl: z.url().nullable().default(null),
    registration: charityRegistrationSchema,
    payoutAccount: charityPayoutAccountInputSchema,
  })
  .refine(
    (application) =>
      (application.region === "AU") === (application.registration.kind === "au_acnc"),
    {
      message: "an AU charity registers with the ACNC; an ID charity is a yayasan",
      path: ["registration"],
    },
  );
export type CharityApplicationRequest = z.infer<typeof charityApplicationRequestSchema>;

/** What a viewer sees at `/charities`: approved charities in their own region only. */
export const publicCharitySchema = z.object({
  id: z.uuid(),
  region: regionSchema,
  name: z.string(),
  cause: charityCauseSchema,
  summary: z.string(),
  logoUrl: z.url().nullable(),
});
export type PublicCharity = z.infer<typeof publicCharitySchema>;

/** The applicant's and staff's view: adds registration, review state and the masked payout account. */
export const charityDetailSchema = publicCharitySchema.extend({
  state: charityStateSchema,
  registration: charityRegistrationSchema,
  payoutAccountName: z.string(),
  payoutAccountLast4: z.string().regex(/^\d{4}$/),
  /** The simulated KYB check's reference for the registration and account. */
  kybReference: z.string(),
  rejectionReason: z.string().nullable(),
  appliedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export type CharityDetail = z.infer<typeof charityDetailSchema>;

/** `POST /api/staff/charities/{charityId}/decision`: a reason is always required. */
export const charityDecisionRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(3).max(500),
});
export type CharityDecisionRequest = z.infer<typeof charityDecisionRequestSchema>;

export const publicCharityListSchema = z.object({ charities: z.array(publicCharitySchema) });
export const charityDetailListSchema = z.object({ charities: z.array(charityDetailSchema) });

/**
 * 13.21.c: one auction's proceeds, captured from the winner and paid straight
 * to the charity's own account. Filled by 13.22's auctions; a record of money
 * that moved to the charity, never a balance YourTal holds.
 */
export const charityProceedSchema = z.object({
  auctionId: z.uuid(),
  amountMinor: z.number().int().positive(),
  currency: z.enum(["AUD", "IDR"]),
  providerReference: z.string().min(1),
  paidAt: z.iso.datetime(),
});
export type CharityProceed = z.infer<typeof charityProceedSchema>;

/** A calendar month's proceeds, the charity's statement line. */
export const charityStatementSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  currency: z.enum(["AUD", "IDR"]),
  auctions: z.number().int().min(0),
  totalMinor: z.number().int().min(0),
});
export type CharityStatement = z.infer<typeof charityStatementSchema>;

/** `GET /api/charities/{charityId}/console`: the charity_admin console. */
export const charityConsoleSchema = z.object({
  charity: charityDetailSchema,
  proceeds: z.array(charityProceedSchema),
  statements: z.array(charityStatementSchema),
});
export type CharityConsole = z.infer<typeof charityConsoleSchema>;
