/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

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
 * a fresh login, a fresh register, or a logout. `sessionBoundaryCaching`
 * below hooks exactly those three `/api/auth/*` calls (the SAME ones
 * `defaultCache` already routes `NetworkOnly`, ahead of it in this array so
 * it wins the match) and, once the network genuinely confirms the boundary
 * (a non-ok response — a failed login attempt, say — changes nothing),
 * empties every page/RSC/API runtime cache. The device's very next
 * navigation for whichever session is now active repopulates them from a
 * real, fresh, same-session fetch; nothing stale from a DIFFERENT session
 * is ever left for an offline read to find.
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

const sessionBoundaryCaching: RuntimeCaching = {
  matcher: /\/api\/auth\/(login|register|logout)$/,
  method: "POST",
  handler: new NetworkOnly({
    networkTimeoutSeconds: 10,
    plugins: [
      {
        fetchDidSucceed: async ({ response }) => {
          if (response.ok) await clearSessionScopedCaches();
          return response;
        },
      },
    ],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [sessionBoundaryCaching, ...defaultCache],
});

serwist.addEventListeners();
