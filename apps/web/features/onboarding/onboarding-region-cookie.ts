/**
 * The cookie name `commit-region-action.ts` writes and
 * `apps/web/features/region/get-region.ts` read. Pulled out of the action
 * itself because a `"use server"` file may only export async functions
 * (Next.js's Server Actions constraint) — a plain `export const` there
 * fails the build with "Only async functions are allowed to be exported in
 * a 'use server' file."
 *
 * 6.1.b: this is now `yt_region` (`REGION_COOKIE`), the same cookie
 * `loginAction`/`registerAction` set from the account's own profile — the
 * old, onboarding-only `yourtal-region` name is retired so there is one
 * region cookie, not two that can drift.
 */
import { REGION_COOKIE } from "@/lib/api/cookies";

export const ONBOARDING_REGION_COOKIE = REGION_COOKIE;
