#!/usr/bin/env node
// YT-0035 — compile the Cerbos policy repo and run its test suites.
//
// Cerbos is distributed as a container, and its own `compile` command is both
// the policy compiler and the test runner. Rather than ask every developer to
// install a binary, this runs the pinned image against ./policies.
//
// The version is pinned deliberately: a policy repo that compiles under one
// Cerbos and not another is a production incident waiting for an upgrade, so
// the version here and the version in the deployed sidecar must move together
// (docs/15 — the stack is locked, not floating).
//
//   node scripts/policy-test.mjs            compile + run every suite
//   node scripts/policy-test.mjs --compile  compile only, skip the tests
//
// Exits non-zero on a compile error or a failing assertion, which is what
// makes it usable as a CI gate.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CERBOS_IMAGE = "ghcr.io/cerbos/cerbos:0.55.0";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policiesDir = path.join(repoRoot, "policies");

const skipTests = process.argv.includes("--compile");

const args = [
  "run",
  "--rm",
  // Read-only: nothing in a policy test should ever write to the repo.
  "-v",
  `${policiesDir}:/policies:ro`,
  CERBOS_IMAGE,
  "compile",
  ...(skipTests ? ["--skip-tests"] : []),
  "/policies",
];

const result = spawnSync("docker", args, {
  stdio: "inherit",
  // Git Bash on Windows rewrites a leading "/policies" into a host path
  // unless this is set, which turns the mount target into nonsense.
  env: { ...process.env, MSYS_NO_PATHCONV: "1" },
});

if (result.error) {
  console.error(
    `\nCould not run Docker: ${result.error.message}\n` +
      `The Cerbos policy tests need Docker to run ${CERBOS_IMAGE}.\n`,
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
