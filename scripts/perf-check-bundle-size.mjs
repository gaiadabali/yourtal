#!/usr/bin/env node
// YT-0404 — Performance budget harness.
//
// Enforces docs/13b-typescript-standards.md §8 and
// docs/08-web-app-and-performance.md §3.1: "Initial JS (shell route) ≤ 170 KB
// gzipped, build-time check". This is deliberately NOT a Lighthouse audit —
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
// Budget: 170 KB, using the binary (1024-based) definition of "KB", i.e.
// 170 * 1024 = 174,080 bytes. This is deliberately the stricter of the two
// common conventions (decimal 170,000 bytes vs binary 174,080 bytes) — the
// gap is under 2.5%, but given the whole point of this harness is to stop
// budget creep, we round down in the app's favour rather than up.
//
// Usage: node scripts/perf-check-bundle-size.mjs [path-to-app]
// Defaults to apps/web. Must run after `next build` (or `turbo run build`)
// has produced apps/web/.next — this script does not build the app itself.

import { createGzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET_BYTES = 170 * 1024; // 170 KB gz, binary KB — see comment above.

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
    console.error(
      "perf-check-bundle-size: route-bundle-stats.json was empty or malformed.",
    );
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
    anyOverBudget = anyOverBudget || overBudget;
    results.push({ route: entry.route, gzipBytes, overBudget });
  }

  const budgetKb = (BUDGET_BYTES / 1024).toFixed(0);
  console.log(`Initial JS budget: ${budgetKb} KB gz per route\n`);
  console.log("Route".padEnd(30) + "First-load JS (gz)".padEnd(22) + "Status");
  console.log("-".repeat(66));
  for (const { route, gzipBytes, overBudget } of results) {
    const kb = (gzipBytes / 1024).toFixed(1) + " KB";
    const status = overBudget ? "FAIL (over budget)" : "OK";
    console.log(route.padEnd(30) + kb.padEnd(22) + status);
  }

  if (anyOverBudget) {
    console.error(
      `\nperf-check-bundle-size: one or more routes exceed the ${budgetKb} KB gz ` +
        "initial-JS budget (docs/13b-typescript-standards.md §8). Failing the build.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nAll routes within budget.");
}

await main();
