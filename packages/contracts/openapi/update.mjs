#!/usr/bin/env node
// Regenerates openapi/yourtal.openapi.json from the Zod schemas. YT-0031.
//
//   pnpm --filter @yourtal/contracts openapi:update
//
// The generator lives inside the drift test rather than in a standalone
// script, for one reason: it guarantees the thing that writes the document and
// the thing that checks it are the same code. A separate writer can drift from
// its own checker, and then CI passes while the artifact is wrong.
//
// This wrapper exists only to set the environment variable cross-platform —
// `UPDATE_OPENAPI=1 vitest` is not a portable command on Windows, and adding
// cross-env for one line would be a dependency for nothing.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = spawnSync("pnpm", ["exec", "vitest", "run", "src/openapi/openapi.test.ts"], {
  cwd: packageRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, UPDATE_OPENAPI: "1" },
});

if (result.error) {
  console.error(`Could not run vitest: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
