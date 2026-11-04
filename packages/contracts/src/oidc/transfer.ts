import * as z from "zod";

/**
 * Group 4.8.a (docs/30 §5): an app's server opens a transfer of one person's
 * data to another app, the person confirms it on YourTal's screen, and the
 * server then fetches an assertion only the destination can open. Authenticated
 * by a client-credentials token with scope `app_transfers`. `fromSub` is always
 * the calling app's own pairwise `sub`.
 */
const subSchema = z.string().min(1).max(255);

/** An Australian financial year, "2025-26". */
export const financialYearSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .refine((year) => (Number(year.slice(0, 4)) + 1) % 100 === Number(year.slice(5)), {
    message: "the two years must follow each other",
  });

/** `POST /api/oidc-clients/transfers`. */
export const transferCreateRequestSchema = z
  .object({
    fromSub: subSchema,
    to: z.literal("ftr"),
    financialYear: financialYearSchema,
    bundleSha256: z.string().regex(/^[0-9a-f]{64}$/),
    lineCount: z.number().int().min(0).max(10_000),
  })
  .strict();
export type TransferCreateRequest = z.infer<typeof transferCreateRequestSchema>;

/** `201` from create. A transfer lasts 15 minutes from here. */
export const transferCreatedSchema = z.object({
  transferId: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type TransferCreated = z.infer<typeof transferCreatedSchema>;

/** `POST /api/oidc-clients/transfers/{transferId}/assertion`. */
export const transferAssertionRequestSchema = z.object({ fromSub: subSchema }).strict();
export type TransferAssertionRequest = z.infer<typeof transferAssertionRequestSchema>;

/**
 * `200`, `Cache-Control: no-store`. `assertion` is a compact JWE (`dir`,
 * `A256GCM`) only the destination can open; pass it on, never decode, log or keep it.
 */
export const transferAssertionSchema = z.object({
  assertion: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type TransferAssertion = z.infer<typeof transferAssertionSchema>;

/**
 * Why a transfer cannot be approved or minted now (docs/30 §5, `/connect`):
 * gone or another app's; started by another account; not an adult in the
 * route's regions, or on hold; the destination's access ended or never began.
 */
export const transferProblemSchema = z.enum([
  "expired",
  "wrong_account",
  "not_allowed",
  "not_connected",
]);
export type TransferProblem = z.infer<typeof transferProblemSchema>;
