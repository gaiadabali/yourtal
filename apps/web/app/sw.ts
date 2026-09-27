/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

/**
 * The Serwist service worker (YT-0424: "renders from cache with the network
 * disabled"). docs/15-stack-locked.md locks Serwist as this platform's PWA
 * / offline tool; installing it here is scoped narrowly to what this
 * ticket's acceptance criterion needs — a previously-visited route (in
 * particular `/wallet/voucher/[voucherId]`) still loads with the network
 * off. It is deliberately NOT a full PWA: there is no `manifest.json` and
 * no install prompt here, because "install prompt at the first successful
 * reward" is YT-0178's own acceptance criterion, a product-level decision
 * (when/whether to prompt installation) this ticket has no brief to make.
 * A future YT-0178 build adds a manifest and an install-prompt component;
 * it does not need to touch this file.
 *
 * `defaultCache` (`@serwist/next/worker`) is Serwist's own recommended
 * Next.js runtime-caching set, not a hand-rolled one: static assets
 * (`_next/static`, fonts, images, JS/CSS) are cached CacheFirst /
 * StaleWhileRevalidate, and — the piece this ticket's criterion actually
 * needs — navigations and RSC payloads for same-origin pages are cached
 * NetworkFirst (`PAGES_CACHE_NAME`). NetworkFirst means: online, always
 * prefer the live network response (so a redeemed/expired voucher's status
 * is never served stale-first); once a route has been fetched at least
 * once, that response is cached and becomes the fallback the instant the
 * network is unavailable. In dev (`NODE_ENV !== "production"`),
 * `defaultCache` degrades to `NetworkOnly` for everything — this SW
 * intentionally caches nothing while running `next dev`, only a real
 * production build.
 *
 * 6.9.b: `defaultCache`'s page/RSC/API caches key purely by request URL —
 * there is no cookie in a Cache API key, and a service worker cannot read
 * the `Cookie` header off an intercepted request either (the platform
 * strips it before JS ever sees it). So "key the cache per session" is not
 * reachable; what IS reachable, and is what actually matters for YT-0424's
 * red line ("no one signed-in user's page is ever handed to another"), is
 * clearing every runtime-cached page whenever the session itself changes —
 * a fresh login, a fresh register, or a logout.
 *
 * That boundary can't be caught by intercepting `/api/auth/*` traffic
 * either, tempting as it looks: `loginAction`/`logoutAction`
 * (`apps/web/lib/api/actions.ts`) are Server Actions, so the fetch to
 * `apps/api` happens on the NEXT.JS SERVER, never as a request this
 * service worker (which only ever sees the BROWSER's own network traffic)
 * can observe. `clear-session-cache.ts`'s `logout-button.tsx` call site
 * knows a session just ended and tells this worker directly with
 * `postMessage`, handled below — see that file's own doc comment for the
 * login-time half this does not cover yet.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Every runtime (non-precache) cache `defaultCache` writes an authenticated response into. Static assets (fonts, `_next/static`, images) are left alone — nothing session-specific lives there. */
const SESSION_SCOPED_CACHE_NAMES = [
  "pages",
  "pages-rsc",
  "pages-rsc-prefetch",
  "apis",
  "next-data",
  "static-data-assets",
  "others",
];

async function clearSessionScopedCaches(): Promise<void> {
  await Promise.all(SESSION_SCOPED_CACHE_NAMES.map((name) => caches.delete(name)));
}

/** `clear-session-cache.ts`'s `postMessage({ type: "yt-clear-session-cache" })` — see this file's own doc comment for why a message, not a network hook, is the only thing that can actually see a session boundary. */
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (typeof data === "object" && data !== null && (data as { type?: unknown }).type === "yt-clear-session-cache") {
    event.waitUntil(clearSessionScopedCaches());
  }
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
