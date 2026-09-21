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
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
