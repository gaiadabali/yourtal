#!/usr/bin/env node
// YT-0518 — runs Atlas, the migration tool locked in docs/15 line 59.
//
//   node scripts/atlas.mjs apply    apply pending migrations
//   node scripts/atlas.mjs status   what is applied and what is pending
//   node scripts/atlas.mjs hash     regenerate atlas.sum after editing a file
//
// Atlas ships as a Go binary. Running it from its official container keeps
// the toolchain pinned and means a developer needs only Docker — the same
// choice, for the same reason, as scripts/policy-test.mjs and the Cerbos CLI.
//
// ## The container has to reach a host port
//
// Postgres is published on 127.0.0.1:26432 (the 26xxx range, because this
// machine already runs four other Postgres instances). Inside a container
// that address is the container itself, so the URL is rewritten to
// host.docker.internal and `--add-host` is passed for the Linux case where
// that name is not resolved automatically.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Pinned by digest, not by tag. `arigaio/atlas:latest` resolves to a
// canary build that moves under you, and a migration tool that changes
// between a developer's run and CI's is a bad surprise to have in the one
// process that edits production schemas. This digest is v1.3.4.
const ATLAS_IMAGE =
  "arigaio/atlas@sha256:5a813e7fe345cc60a016cae50391805324f1fe04a9043e859afb29355a770cdd";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

const command = process.argv[2] ?? "status";

const databaseUrl = resolveDatabaseUrl();
if (databaseUrl === undefined) {
  console.error(
    "No DATABASE_URL. Copy .env.example to .env and run `pnpm dev:up` from the repo root.",
  );
  process.exit(1);
}

// Atlas needs a scratch database to compute the desired state. Pointing it at
// a separate database on the same server keeps it away from anything real.
const devUrl = databaseUrl.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

const ARGS = {
  // --allow-dirty: the database is NOT empty before the first migration.
  // infra/postgres/init/01-schemas.sql runs at container start and creates
  // the six domain schemas and the two roles, because role separation has
  // to exist before anything is granted on it. Atlas sees those objects and
  // refuses a first apply unless told they are expected. They are: that
  // script is the bootstrap, and these migrations own everything after it.
  apply: [
    "migrate",
    "apply",
    "--dir",
    "file://migrations",
    "--url",
    fromContainer(databaseUrl),
    "--allow-dirty",
  ],
  status: ["migrate", "status", "--dir", "file://migrations", "--url", fromContainer(databaseUrl)],
  hash: ["migrate", "hash", "--dir", "file://migrations"],
  lint: [
    "migrate",
    "lint",
    "--dir",
    "file://migrations",
    "--dev-url",
    fromContainer(devUrl),
    "--latest",
    "1",
  ],
};

const atlasArgs = ARGS[command];
if (atlasArgs === undefined) {
  console.error(`Unknown command "${command}". Use: ${Object.keys(ARGS).join(", ")}`);
  process.exit(1);
}

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--add-host",
    "host.docker.internal:host-gateway",
    "-v",
    `${packageRoot}:/work`,
    "-w",
    "/work",
    ATLAS_IMAGE,
    ...atlasArgs,
  ],
  { stdio: "inherit", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
);

if (result.error) {
  console.error(`\nCould not run Docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

/** Reads DATABASE_URL from the environment, falling back to the repo .env. */
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL !== undefined) return process.env.DATABASE_URL;

  const envFile = path.join(repoRoot, ".env");
  if (!existsSync(envFile)) return undefined;

  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

/**
 * 127.0.0.1 means the container itself; the host is host.docker.internal.
 *
 * `sslmode=disable` is appended because the local Postgres has no TLS and
 * Atlas otherwise fails with "SSL is not enabled on the server". Local only:
 * a deployed environment passes its own DATABASE_URL, and docs/14 section 8
 * requires TLS 1.3 there, so this must never become a default.
 */
function fromContainer(url) {
  const hosted = url
    .replace("127.0.0.1", "host.docker.internal")
    .replace("localhost", "host.docker.internal");
  if (hosted.includes("sslmode=")) return hosted;
  return hosted.includes("?") ? `${hosted}&sslmode=disable` : `${hosted}?sslmode=disable`;
}
