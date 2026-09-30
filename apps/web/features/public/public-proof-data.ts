import "server-only";

import * as z from "zod";
import { provedDaySchema } from "@yourtal/contracts/ledger-internal/proof";
import { publicApiFetch } from "@/lib/api/public-api-fetch";

/** Roots are published once per day — an hour is plenty fresh and keeps this off the request path most of the time. */
const PROOF_ROOTS_REVALIDATE_SECONDS = 60 * 60;

const proofRootsResponseSchema = z.object({ roots: z.array(provedDaySchema) });

/**
 * 11.3.c: `GET /api/proof/roots` (10.3.b, `@PublicRoute` — "anyone can
 * verify a day's root later"), read the same cookie-free, revalidate-on-a-
 * timer way every other public data function in this feature does. Never
 * throws: an unreachable ledger or a day with nothing proved yet both come
 * back as an empty list, which `PublicTransparencyContent` renders as an
 * honest "nothing published yet" state rather than a broken page.
 */
export async function getPublicProofRoots() {
  const result = await publicApiFetch("/api/proof/roots", proofRootsResponseSchema, {
    revalidate: PROOF_ROOTS_REVALIDATE_SECONDS,
  });
  return result.ok ? result.data.roots : [];
}
