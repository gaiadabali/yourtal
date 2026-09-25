/**
 * The three cookies the web app itself sets and reads for identity plumbing
 * (1.7.a/b). Named `yt_*` to match the API's own `yt_session` (1.5.a) and
 * the merchant counter's future `yt_device` (8.1) — one prefix, one place
 * each name is spelled, so `proxy.ts` and every Server Action agree by
 * construction rather than by four call sites repeating a string literal.
 *
 * Deliberately dependency-free — no `next/headers`, no `server-only` — so
 * both `session-cookies.ts` (a Server Component/Action reader) and
 * `proxy.ts` (Edge middleware, a different runtime with no React Server
 * Components condition, where the real `server-only` package's `index.js`
 * throws unconditionally rather than resolving to its `react-server` stub)
 * can import it. Same reasoning as `apps/web/features/region/region-cookie.ts`.
 *
 * `yt_locale`/`yt_region` are DELIBERATELY separate from the pre-existing
 * `yourtal-region` cookie in `apps/web/features/region/region-cookie.ts`
 * (B-owned): 6.1.b is where B migrates region/locale reading onto these two
 * and retires the old name. Until then the two live side by side — nothing
 * in this file ever reads or writes `yourtal-region`.
 */
export const SESSION_COOKIE = "yt_session";
export const LOCALE_COOKIE = "yt_locale";
export const REGION_COOKIE = "yt_region";

/** Same fallbacks as 0.5.a's `DEFAULT_REGION` — AU/en-AU, never ID (F2). */
export const DEFAULT_REGION = "AU";
export const DEFAULT_LOCALE = "en-AU";

/** F12 "Sessions": consumer sessions are 30 days sliding, 90 days absolute — the absolute cap is enforced by `SessionService` (1.5.e), this is only the cookie's own outer bound. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Locale/region are account facts, not session state — a year is "effectively forever" without being literally infinite. */
export const PREFERENCE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
