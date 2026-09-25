import "server-only";
// YT-0589: the enforcement this module's doc comment says does not exist.
// Importing this file from a client graph is now a BUILD FAILURE rather
// than a review catch. See apps/web/features/README-server-only.md.

import { cookies } from "next/headers";
import { regionSchema, type Region } from "@yourtal/contracts/region";
import { regionDisplayConfig, type RegionDisplayConfig } from "./region-config";
import { REGION_COOKIE_NAME } from "./region-cookie";

const DEFAULT_REGION: Region = "AU";

/**
 * Resolves the active region for a Server Component, without prop-drilling:
 * any Server Component in the tree can call this directly, the same way
 * Next.js's own `cookies()`/`headers()` are ambient rather than threaded
 * through props. Client Components use `useRegion()`
 * (`region-context.tsx`/`use-region.ts`) instead — they cannot call this,
 * since `cookies()` is a server-only API.
 *
 * There is no registration flow yet (YT-0405 is foundation only; region
 * selection at registration is a future ticket), so this defaults to "AU"
 * (task 0.5) — English/AUD for a cookie-less first visit — until something
 * writes a validated value to the `yourtal-region` cookie.
 *
 * This file is NOT marked `"use client"` and must never be imported from a
 * file that is: it value-imports `regionSchema` (Zod) and calls a
 * server-only Next API, and importing it into client-reachable code would
 * both crash (no `cookies()` in the browser) and blow the initial-JS budget
 * (docs/13b-typescript-standards.md §8). The repo has no `server-only`
 * package installed to enforce this at build time (see YT-0405's report);
 * until it is added, this comment is the only guard.
 */
export async function getRegion(): Promise<Region> {
  const cookieStore = await cookies();
  const parsed = regionSchema.safeParse(cookieStore.get(REGION_COOKIE_NAME)?.value);
  return parsed.success ? parsed.data : DEFAULT_REGION;
}

/**
 * Convenience for the common case: a Server Component that only wants
 * `{ locale, currency }` to hand to a formatter, not the raw region code.
 * Same server-only restriction as `getRegion()`.
 */
export async function getRegionDisplayConfig(): Promise<RegionDisplayConfig> {
  return regionDisplayConfig(await getRegion());
}
