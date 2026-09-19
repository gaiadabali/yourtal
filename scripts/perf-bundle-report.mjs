#!/usr/bin/env node
// YT-0404 — Performance budget harness.
//
// Renders the same per-route first-load-JS numbers used by
// scripts/perf-check-bundle-size.mjs as a Markdown table, for posting as a
// sticky PR comment (see .github/workflows/perf-budget.yml). This script
// never fails the build itself — scripts/perf-check-bundle-size.mjs is the
// gate; this one is purely reporting, so it can run even when the gate has
// already failed and still tell the reviewer what actually shipped.
//
// Usage: node scripts/perf-bundle-report.mjs [path-to-app] > report.md

import { createGzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET_BYTES = 170 * 1024;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const appDir = path.resolve(repoRoot, process.argv[2] ?? "apps/web");
const outFile = process.argv[3];
const statsPath = path.join(appDir, ".next", "diagnostics", "route-bundle-stats.json");

/** @param {string} filePath */
function gzipSize(filePath) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const gzip = createGzip({ level: 9 });
    gzip.on("data", (chunk) => (size += chunk.length));
    gzip.on("end", () => resolve(size));
    gzip.on("error", reject);
    const read = createReadStream(filePath);
    read.on("error", reject);
    read.pipe(gzip);
  });
}

async function main() {
  const raw = await readFile(statsPath, "utf8");
  /** @type {Array<{ route: string; firstLoadChunkPaths: string[] }>} */
  const routes = JSON.parse(raw);

  const rows = [];
  for (const entry of routes) {
    if (entry.route === "/_not-found" || entry.route === "/_global-error") continue;
    const uniquePaths = [...new Set(entry.firstLoadChunkPaths)];
    const absolutePaths = uniquePaths.map((p) =>
      path.join(appDir, ...p.split(/[\\/]/).filter(Boolean)),
    );
    const sizes = await Promise.all(absolutePaths.map(gzipSize));
    const gzipBytes = sizes.reduce((a, b) => a + b, 0);
    rows.push({ route: entry.route, gzipBytes });
  }

  const budgetKb = (BUDGET_BYTES / 1024).toFixed(0);
  const lines = [];
  lines.push("### Bundle size report (YT-0404)");
  lines.push("");
  lines.push(`Initial-JS budget: **${budgetKb} KB gz** per route (first-load JS, as reported by Next's own \`route-bundle-stats.json\`).`);
  lines.push("");
  lines.push("| Route | First-load JS (gz) | vs budget | Status |");
  lines.push("|---|---|---|---|");
  for (const { route, gzipBytes } of rows) {
    const kb = gzipBytes / 1024;
    const pct = ((gzipBytes / BUDGET_BYTES) * 100).toFixed(0);
    const status = gzipBytes > BUDGET_BYTES ? "❌ over budget" : "✅ ok";
    lines.push(`| \`${route}\` | ${kb.toFixed(1)} KB | ${pct}% | ${status} |`);
  }
  lines.push("");
  lines.push(
    "_INP is a field metric and cannot be measured in a Lighthouse lab run; the CI gate asserts on Total Blocking Time as a lab proxy instead. See `apps/web/lighthouserc.cjs` for the throttling profile and the full metric-substitution rationale._",
  );
  const markdown = lines.join("\n") + "\n";

  if (outFile) {
    await writeFile(path.resolve(repoRoot, outFile), markdown, "utf8");
  } else {
    process.stdout.write(markdown);
  }
}

await main();
