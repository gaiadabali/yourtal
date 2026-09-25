#!/usr/bin/env node
// 4.9.d: B (the backing rate) never reaches a browser. After `next build`,
// fail if any client chunk names one of B's fields. Usage:
//   node scripts/check-bundle-no-backing-rate.mjs [apps/web]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const FORBIDDEN = ["micros_per_point", "issuePriceMicros", "backingMicros"];

const appDir = path.resolve(process.argv[2] ?? "apps/web");
const staticDir = path.join(appDir, ".next", "static");
if (!existsSync(staticDir)) {
  // No build means nothing was checked, which is not a pass.
  console.error(`No ${staticDir}: run \`next build\` first.`);
  process.exit(1);
}

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(js|mjs|map|json|txt)$/.test(entry.name)) yield full;
  }
}

let scanned = 0;
const hits = [];
for (const file of files(staticDir)) {
  scanned += 1;
  const text = readFileSync(file, "utf8");
  for (const word of FORBIDDEN) {
    if (text.includes(word)) hits.push(`${path.relative(appDir, file)}: ${word}`);
  }
}

if (scanned === 0) {
  console.error(`${staticDir} holds no chunks: the build did not produce a client bundle.`);
  process.exit(1);
}
if (hits.length > 0) {
  console.error(
    `B reaches the browser in ${String(hits.length)} place(s):\n  ${hits.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`No backing-rate field in ${String(scanned)} client files.`);
