import { notFound } from "next/navigation";
import { regionSchema } from "@yourtal/contracts/region";
import type { Region } from "@yourtal/contracts/region";

/**
 * Validates the `[region]` dynamic segment against the real region contract
 * (YT-0405's `regionSchema`), 404-ing on anything else — an unknown code,
 * a lowercase segment, or a stale bookmark from before a region was retired.
 *
 * Server-only by construction: every call site is a Server Component
 * `page.tsx` (see `apps/web/app/(app)/onboarding/[region]/*`), never a
 * "use client" file. `regionSchema` is a Zod value import, which is free on
 * the server (this module's code never ships to the browser) and exactly
 * the ~96 KB-of-Zod cost the budget forbids in a client bundle
 * (docs/13b-typescript-standards.md section 8) — see
 * `onboarding-region-derived.ts` for the client-side stopgap this project
 * needs instead.
 *
 * `notFound()` is typed `never`, so TypeScript narrows `parsed.data` to
 * `Region` after the guard without an explicit cast.
 */
export function requireRegionParam(rawRegion: string): Region {
  const parsed = regionSchema.safeParse(rawRegion.toUpperCase());
  if (!parsed.success) {
    notFound();
  }
  return parsed.data;
}
