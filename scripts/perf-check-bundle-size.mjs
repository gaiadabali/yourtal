#!/usr/bin/env node
// YT-0404 — Performance budget harness.
//
// Enforces docs/13b-typescript-standards.md §8: initial JS per route
// <= 200 KB gzipped as a hard gate, with anything above 180 KB requiring a
// written justification in the PR. This is deliberately NOT a Lighthouse audit —
// Lighthouse's `total-byte-weight` measures everything the page loads
// (images, fonts, third-party), which is adjacent to but not the same thing
// as "first-load JS for the route". Next.js's own build already computes the
// exact set of JS chunks required before a route is interactive and writes
// it to `.next/diagnostics/route-bundle-stats.json` (one entry per route,
// with the chunk paths that make up that route's first load). That is the
// authoritative source Next itself uses for the "First Load JS" column in
// classic (non-Turbopack) build output, so we read it directly instead of
// re-deriving it from webpack/turbopack stats or guessing from source.
//
// Budget, revised 2026-09-19: 200 KB hard gate, 180 KB warning threshold.
// The original 170 KB predated measuring the Next 16 + React 19 framework
// floor of ~147 KB, which left ~23 KB for all application code — not a
// budget, a wish. The warning band exists so the gate still has teeth: a
// route between 180 and 200 KB passes CI but is flagged here and needs a
// written justification, which is what stops silent creep toward the cap.
//
// The REAL gate is the outcome — LCP <= 2.0 s and TBT <= 200 ms on mid-tier
// Android over 4G, asserted in apps/web/lighthouserc.cjs. KB is a guardrail,
// not the goal; do not contort a route to shave bytes that buy no measured
// improvement in those numbers.
//
// TBT IS A LAB PROXY, NOT THE TARGET (YT-0501). The metric the product
// actually cares about is INP, and INP is a FIELD metric: Lighthouse cannot
// measure it, because it needs real interactions from real users. TBT is
// Lighthouse's documented stand-in — see apps/web/lighthouserc.cjs for the
// substitution rationale in full. Passing TBT here is evidence about a lab
// run on a throttled profile, not evidence that real users experience a
// responsive page; only the field RUM reporting p75 INP can say that.
// Stated here rather than only where the assertion lives, because this is
// the file someone reads when a route is near the cap and it was the one
// place TBT appeared without the qualifier.
//
// Both thresholds use the binary (1024-based) "KB", i.e. 200 * 1024 =
// 204,800 bytes — the stricter of the two common conventions.
//
// NOTE: docs/08-web-app-and-performance.md §3.1 still states the superseded
// 170 KB figure. docs/13b §8 is the current authority; that inconsistency
// has been raised with the docs owner.
//
// Usage: node scripts/perf-check-bundle-size.mjs [path-to-app]
// Defaults to apps/web. Must run after `next build` (or `turbo run build`)
// has produced apps/web/.next — this script does not build the app itself.

import { createGzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET_BYTES = 200 * 1024; // Hard gate. Binary KB — see comment above.
const JUSTIFY_BYTES = 180 * 1024; // Above this, a PR needs written justification.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const appDir = path.resolve(repoRoot, process.argv[2] ?? "apps/web");
const nextDir = path.join(appDir, ".next");
const statsPath = path.join(nextDir, "diagnostics", "route-bundle-stats.json");

/**
 * @param {string} filePath
 * @returns {Promise<number>}
 */
function gzipSize(filePath) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const gzip = createGzip({ level: 9 });
    gzip.on("data", (chunk) => {
      size += chunk.length;
    });
    gzip.on("end", () => resolve(size));
    gzip.on("error", reject);
    const read = createReadStream(filePath);
    read.on("error", reject);
    read.pipe(gzip);
  });
}

async function main() {
  let raw;
  try {
    raw = await readFile(statsPath, "utf8");
  } catch (error) {
    console.error(
      `perf-check-bundle-size: could not read ${statsPath}.\n` +
        `Did you run "next build" in ${appDir} first? This script reads Next's\n` +
        `own route-bundle-stats diagnostic; it does not build the app.\n` +
        `(${/** @type {Error} */ (error).message})`,
    );
    process.exitCode = 1;
    return;
  }

  /** @type {Array<{ route: string; firstLoadUncompressedJsBytes: number; firstLoadChunkPaths: string[] }>} */
  const routes = JSON.parse(raw);

  if (!Array.isArray(routes) || routes.length === 0) {
    console.error("perf-check-bundle-size: route-bundle-stats.json was empty or malformed.");
    process.exitCode = 1;
    return;
  }

  /** @type {Array<{ route: string; gzipBytes: number; overBudget: boolean }>} */
  const results = [];
  let anyOverBudget = false;

  for (const entry of routes) {
    // Internal Next scaffolding routes aren't shipped to real users and
    // shouldn't gate the build. Everything else — every real route — is
    // measured, including ones that don't exist yet; new routes fall under
    // this gate automatically as they land in later tickets.
    if (entry.route === "/_not-found" || entry.route === "/_global-error") {
      continue;
    }

    const uniqueChunkPaths = [...new Set(entry.firstLoadChunkPaths)];
    const absolutePaths = uniqueChunkPaths.map((chunkPath) =>
      // Paths in the diagnostic file are relative to the app dir and may use
      // OS-specific separators (they're written with `\` on Windows).
      path.join(appDir, ...chunkPath.split(/[\\/]/).filter(Boolean)),
    );

    const sizes = await Promise.all(absolutePaths.map((p) => gzipSize(p)));
    const gzipBytes = sizes.reduce((sum, size) => sum + size, 0);
    const overBudget = gzipBytes > BUDGET_BYTES;
    const needsJustification = !overBudget && gzipBytes > JUSTIFY_BYTES;
    anyOverBudget = anyOverBudget || overBudget;
    results.push({ route: entry.route, gzipBytes, overBudget, needsJustification });
  }

  const budgetKb = (BUDGET_BYTES / 1024).toFixed(0);
  const justifyKb = (JUSTIFY_BYTES / 1024).toFixed(0);
  console.log(
    `Initial JS: ${budgetKb} KB gz hard gate · above ${justifyKb} KB needs justification\n`,
  );
  console.log("Route".padEnd(34) + "First-load JS (gz)".padEnd(22) + "Status");
  console.log("-".repeat(74));
  for (const { route, gzipBytes, overBudget, needsJustification } of results) {
    const kb = (gzipBytes / 1024).toFixed(1) + " KB";
    const status = overBudget
      ? `FAIL (over ${budgetKb} KB)`
      : needsJustification
        ? `OK — justify (over ${justifyKb} KB)`
        : "OK";
    console.log(route.padEnd(34) + kb.padEnd(22) + status);
  }

  // A hard gate alone lets a route creep to 199 KB unnoticed. This band is
  // what keeps the number honest between the floor and the cap.
  const toJustify = results.filter((r) => r.needsJustification);
  if (toJustify.length > 0) {
    console.log(
      `\n${toJustify.length} route(s) above ${justifyKb} KB — these pass the gate but need a ` +
        "written justification in the PR (docs/13b-typescript-standards.md §8):",
    );
    for (const r of toJustify) {
      console.log(`  - ${r.route} at ${(r.gzipBytes / 1024).toFixed(1)} KB`);
    }
  }

  if (anyOverBudget) {
    console.error(
      `\nperf-check-bundle-size: one or more routes exceed the ${budgetKb} KB gz ` +
        "initial-JS hard gate (docs/13b-typescript-standards.md §8). Failing the build.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nAll routes within the hard gate.");
}

await main();
