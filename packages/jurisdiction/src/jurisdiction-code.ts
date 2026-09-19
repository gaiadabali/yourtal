import { z } from "zod";

/**
 * The two markets the platform operates in, and nothing else.
 *
 * Mirrors `packages/authz/src/principal.ts`'s `jurisdiction` attribute
 * exactly — that file's comment says switches live here, in YT-0037, and
 * this is the one enum both sides must agree on. A third jurisdiction is
 * added by extending this enum AND adding a `JurisdictionPolicy` entry in
 * `policy-data.ts`; the schema in `policy-schema.ts` makes the second step
 * unskippable (see that file's header comment).
 */
export const jurisdictionCodeSchema = z.enum(["ID", "AU"]);

export type JurisdictionCode = z.infer<typeof jurisdictionCodeSchema>;
