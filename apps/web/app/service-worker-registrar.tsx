"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (YT-0588, closing YT-0424).
 *
 * ## Why this is hand-written
 *
 * `@serwist/next`'s webpack plugin did two separate jobs: it **compiled**
 * `app/sw.ts` into `public/sw.js`, and it **injected the registration call**
 * into the client bundle. Under Turbopack it does neither, silently.
 *
 * `scripts/build-service-worker.mjs` replaced the first job. This replaces
 * the second — and the distinction cost a test run to find: with the worker
 * built but nothing registering it, `navigator.serviceWorker.ready` never
 * resolves, so the offline suite hung at "waiting for an activated worker"
 * rather than failing with anything that named the real cause. A file that
 * exists and a worker that is running are different facts.
 *
 * ## Scope and timing
 *
 * Registered from the `(app)` root layout, but the scope is `/` — a worker
 * registered at the origin root controls every route, including the public
 * surface, which is what the runtime caching in `app/sw.ts` assumes.
 *
 * Production only. `defaultCache` degrades to `NetworkOnly` in development
 * anyway (see `app/sw.ts`), so a dev registration would cache nothing while
 * still adding a worker that outlives a dev-server restart and confuses
 * hot reload.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (!("serviceWorker" in navigator)) {
      return;
    }

    // Registration failure must not break the page: offline support is an
    // enhancement, and a browser that refuses the worker (private mode,
    // disabled storage, an unsupported scope) should still render normally.
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("[sw] registration failed; the app works, offline support does not", error);
    });
  }, []);

  return null;
}
