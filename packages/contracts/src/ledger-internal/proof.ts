import * as z from "zod";

/**
 * 10.3.b: F11's "generation, redemption and a client SDK, secure and
 * tamper-evident (a hash chain anchored in the daily proof, with the root
 * published)". `GET /api/proof/roots` (apps/api) republishes this verbatim,
 * no auth of its own — anyone can verify a day's root against their own
 * copy of that day's entries, without a blockchain.
 */
export const provedDaySchema = z.object({
  date: z.iso.date(),
  merkleRoot: z.string().min(1),
  entryCount: z.number().int().min(0),
  computedAt: z.iso.datetime(),
});
export type ProvedDay = z.infer<typeof provedDaySchema>;
