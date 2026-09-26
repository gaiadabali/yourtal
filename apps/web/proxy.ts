import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isStaging } from "./features/shell/app-env";
import { SESSION_COOKIE } from "./lib/api/cookies";
import { routeRedirects } from "./route-redirects";

/**
 * Next.js 16's rename of `middleware.ts` — same edge runtime, same
 * `NextRequest`/`NextResponse` API, exported under the name `proxy` instead
 * (see `next/dist/lib/constants.js`'s `PROXY_FILENAME`).
 *
 * 1.7.c: protects exactly these prefixes by redirecting an unauthenticated
 * request to `/login?returnTo=`. **Never an open fallback** — anything not
 * listed here (or under `/merchant`, handled separately below) falls
 * through to `NextResponse.next()` unconditionally, which is correct
 * because "everything else stays public" is the actual rule, not an
 * oversight. A route that should be protected and is missing from this list
 * is a bug in this list, not a reason to add a catch-all.
 *
 * This is a coarse, cookie-PRESENCE gate only — it never calls the API and
 * never validates the token. A forged or expired `yt_session` cookie still
 * passes this check and is refused by the API itself once 1.5.a lands
 * (`PrincipalService`/`SessionService.validateAndTouch`), the same
 * "coarse edge check, real check downstream" split `PdpGuard`'s own doc
 * comments describe for authorization.
 */
const PROTECTED_PREFIXES = [
  "/home",
  "/watch",
  "/campaign",
  "/store",
  "/wallet",
  "/me",
  "/onboarding",
  "/quick",
  "/business",
  "/studio",
  "/staff",
] as const;

/**
 * The merchant counter (8.1) is a device credential, not a personal
 * session — `yt_device`, never `yt_session`. Verified for real on the
 * server through the 1.5.c `StoreDevicePrincipalResolver`; this is only the
 * same coarse presence check as the session gate above. `/merchant/pair` is
 * the one public page (a device with no credential yet has to reach it).
 */
const MERCHANT_DEVICE_COOKIE = "yt_device";
const MERCHANT_PAIR_PATH = "/merchant/pair";

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function proxy(request: NextRequest): NextResponse {
  const response = route(request);
  // Staging must never be indexed (2.3.a). nginx sets this too; the app says
  // it itself so the posture survives any proxy in front of it.
  if (isStaging()) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

function route(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);

  for (const rule of routeRedirects) {
    if (pathname !== rule.path) continue;
    const destination = rule.resolve({ signedIn });
    if (destination !== null) {
      return NextResponse.redirect(new URL(destination, request.url));
    }
  }

  if (matchesPrefix(pathname, "/merchant")) {
    if (pathname === MERCHANT_PAIR_PATH || pathname.startsWith(`${MERCHANT_PAIR_PATH}/`)) {
      return NextResponse.next();
    }
    if (!request.cookies.has(MERCHANT_DEVICE_COOKIE)) {
      return NextResponse.redirect(new URL(MERCHANT_PAIR_PATH, request.url));
    }
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
  if (isProtected && !signedIn) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

/**
 * Broad on purpose: every route not excluded here still runs through
 * `proxy()`, which itself defaults to `NextResponse.next()` for anything
 * not in `PROTECTED_PREFIXES` or `/merchant`. A narrow matcher that misses a
 * future protected route silently un-protects it; a broad matcher with an
 * explicit allow-list inside the function cannot.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|apple-icon\\.png|icon\\.svg|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|sw\\.js).*)",
  ],
};
