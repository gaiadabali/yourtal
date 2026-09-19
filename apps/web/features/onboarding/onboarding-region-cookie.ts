/**
 * The cookie name `commit-region-action.ts` writes and
 * `apps/web/features/region/get-region.ts` (YT-0405) reads. Pulled out of
 * the action itself because a `"use server"` file may only export async
 * functions (Next.js's Server Actions constraint) — a plain `export const`
 * there fails the build with "Only async functions are allowed to be
 * exported in a 'use server' file."
 */
import { REGION_COOKIE_NAME } from "@/features/region/region-cookie";

export const ONBOARDING_REGION_COOKIE = REGION_COOKIE_NAME;
