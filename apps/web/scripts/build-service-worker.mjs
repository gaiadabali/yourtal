#!/usr/bin/env node
/**
 * Builds the Serwist service worker as its own step, independent of the
 * bundler Next uses (YT-0588, closing YT-0424).
 *
 * ## Why this exists
 *
 * `@serwist/next`'s `withSerwistInit` hooks into **webpack's** compiler.
 * This app builds with **Turbopack** — Next 16's default, and this repo's,
 * via a bare `next build`. Under Turbopack the plugin is a silent no-op:
 * no error, no warning, and `public/sw.js` is simply never written. The
 * offline behaviour YT-0424 proves in `e2e/offline-voucher-detail.spec.ts`
 * therefore did not exist in what `pnpm build` actually shipped.
 *
 * The obvious fix — force `next build --webpack` — was evaluated and
 * rejected. `.next/diagnostics/route-bundle-stats.json`, which YT-0404's
 * performance-budget gate reads directly (`scripts/perf-check-bundle-size.mjs`),
 * is written **only** by a Turbopack build. Switching the default bundler
 * would silently disable that gate, and per YT-0569 it is `pull_request`-only
 * and barely fires as it is, so nobody would notice it had gone.
 *
 * So the service worker and the performance budget needed different
 * bundlers. Decoupling the service worker from the Next build removes the
 * conflict rather than choosing a side: Next keeps Turbopack and its
 * diagnostics, and the worker is compiled here by Serwist's own builder.
 *
 * ## `output: "standalone"`
 *
 * `next.config.ts` sets `output: "standalone"`. Next does not copy `public/`
 * into that output — it is documented as the deployer's job — and in a
 * monorepo the output nests under `.next/standalone/apps/web`. Verified on
 * disk rather than assumed: a clean build leaves no `public` directory there
 * at all. So when a standalone build is present this script creates the
 * directory and places the worker in it, and checks the result, so the
 * standalone server does not 404 on the one file it exists to serve.
 */

import { injectManifest } from "@serwist/build";
import { build as esbuild } from "esbuild";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const swSrc = path.join(appDir, "app", "sw.ts");
const swDest = path.join(appDir, "public", "sw.js");
const swBundled = path.join(appDir, ".next", "sw-bundled.js");
// In a monorepo Next nests the standalone output under the workspace path,
// so this is `.next/standalone/apps/web`, not `.next/standalone`. Next also
// does NOT copy `public/` into a standalone build at all — that copy is
// documented as the deployer's job — so this creates the directory rather
// than assuming the build left one.
const standaloneAppDir = path.join(appDir, ".next", "standalone", "apps", "web");

if (!existsSync(path.join(appDir, ".next"))) {
  console.error(
    "[sw] No .next directory. This script runs AFTER `next build` — it precaches that build's output.",
  );
  process.exit(1);
}

await mkdir(path.dirname(swDest), { recursive: true });

/**
 * BUNDLE FIRST. `injectManifest` does exactly what its name says — it
 * injects a precache manifest into a script. It does NOT compile or bundle
 * one. Pointing it straight at `app/sw.ts` produced a `public/sw.js` that
 * was still TypeScript, `import type` and bare specifiers included, which
 * the browser cannot parse: the worker never installed, so
 * `navigator.serviceWorker.ready` never resolved and the offline suite hung
 * rather than failing with anything that named the cause.
 *
 * That half of the job was also the webpack plugin's, alongside compiling
 * and registering. Three jobs, not one.
 *
 * `format: "iife"` matters: the worker is registered as a CLASSIC script
 * (`navigator.serviceWorker.register("/sw.js")` with no `{ type: "module" }`),
 * and an ESM bundle would fail to parse in exactly the same silent way.
 */
await esbuild({
  entryPoints: [swSrc],
  outfile: swBundled,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  // `defaultCache` branches on this; the worker must be built for the
  // environment it will actually run in, not the one that built it.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

// Precache the immutable build output. `_next/static/**` is content-hashed,
// so `dontCacheBustURLsMatching` stops Serwist appending a revision query to
// URLs that are already unique — otherwise every asset is re-fetched on each
// deploy despite being byte-identical.
const { count, size, warnings } = await injectManifest({
  swSrc: swBundled,
  swDest,
  globDirectory: path.join(appDir, ".next"),
  globPatterns: ["static/**/*.{js,css,woff2}"],
  modifyURLPrefix: { "static/": "/_next/static/" },
  dontCacheBustURLsMatching: /^\/_next\/static\//,
  // The page shells themselves are handled at runtime by `defaultCache`'s
  // NetworkFirst strategy (see app/sw.ts) rather than precached, so a
  // voucher's status is never served stale-first while online.
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
});

for (const warning of warnings) {
  console.warn(`[sw] ${warning}`);
}

const { size: bytes } = await stat(swDest);
console.log(
  `[sw] wrote public/sw.js (${(bytes / 1024).toFixed(1)} KB), precaching ${count} files, ${(size / 1024 / 1024).toFixed(2)} MB`,
);

// `output: "standalone"` copied public/ before this script ran, so the
// standalone server would otherwise 404 on the worker it is meant to serve.
if (existsSync(standaloneAppDir)) {
  const standaloneDest = path.join(standaloneAppDir, "public", "sw.js");
  await mkdir(path.dirname(standaloneDest), { recursive: true });
  await copyFile(swDest, standaloneDest);
  if (!existsSync(standaloneDest)) {
    console.error("[sw] failed to copy the worker into the standalone output");
    process.exit(1);
  }
  console.log("[sw] copied into .next/standalone/apps/web/public/sw.js");
}
