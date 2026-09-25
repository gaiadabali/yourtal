import "server-only";
// YT-0589: importing this from a client graph is a build failure, not a
// review catch, once `server-only` is aliased for the client bundle — see
// apps/web/features/README-server-only.md.

import { cookies } from "next/headers";
import type { Region } from "@yourtal/contracts/region";
import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import {
  LOCALE_COOKIE,
  PREFERENCE_COOKIE_MAX_AGE_SECONDS,
  REGION_COOKIE,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "./cookies";

/**
 * Flags kept consistent with 1.5.e's API-side session cookie (Secure,
 * HttpOnly, SameSite=Lax): `secure` is skipped only in non-production, the
 * same way every other cookie writer in this app (`commit-region-action.ts`,
 * `device-session-cookie.ts`) already assumes plain HTTP in dev.
 */
function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * Sets all three identity cookies at once (1.7.b) — the shape both
 * `loginAction` and a future `registerAction` need: a session token plus
 * the account's OWN region and locale, never a guess made by the caller.
 */
export async function setSessionCookies(input: {
  token: string;
  region: Region;
  displayLocale: DisplayLocale;
}): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, input.token, cookieOptions(SESSION_COOKIE_MAX_AGE_SECONDS));
  store.set(REGION_COOKIE, input.region, cookieOptions(PREFERENCE_COOKIE_MAX_AGE_SECONDS));
  store.set(LOCALE_COOKIE, input.displayLocale, cookieOptions(PREFERENCE_COOKIE_MAX_AGE_SECONDS));
}

/** `PATCH /api/me` only ever changes display name/locale (region is immutable), so only this cookie moves. */
export async function setLocaleCookie(displayLocale: DisplayLocale): Promise<void> {
  const store = await cookies();
  store.set(LOCALE_COOKIE, displayLocale, cookieOptions(PREFERENCE_COOKIE_MAX_AGE_SECONDS));
}

/**
 * Ends the session cookie only. `yt_locale`/`yt_region` are preferences, not
 * session state — a signed-out visitor on a shared device still sees their
 * own language and currency next time, the same way a logged-out browser
 * keeps its dark-mode choice.
 */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** `null` when signed out — the one check `proxy.ts` and `apiFetch` both need, from the one place either cookie is named. */
export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
