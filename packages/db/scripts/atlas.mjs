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
import { fileURLToPath } from "node:url";
import path from "node:path";

// Pinned by digest, not by tag. `arigaio/atlas:latest` resolves to a
// canary build that moves under you, and a migration tool that changes
// between a developer's run and CI's is a bad surprise to have in the one
// process that edits production schemas. This digest is v1.3.3 (0.8.f: the
// prior digest here was mislabelled v1.3.4 and was in fact a canary build).
const ATLAS_IMAGE =
  "arigaio/atlas:1.3.3@sha256:07f3f92fa46e684ed789d5ef344a25494a4fa6844ef1ea1fa4e138522c2c37ac";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

// Shared env loading (YT-0552 follow-up, tracked in the .env-loader ticket).
// This used to hand-roll a regex parse of the root `.env` here — the only
// place in the repo that did, because nothing else loaded it either. Every
// Node entrypoint now uses this same mechanism: `apps/api`'s dev/start
// scripts pass `--env-file-if-exists=../../.env` to `node` itself, and this
// script — which isn't spawned through a `node` CLI flag, since it's `node
// scripts/atlas.mjs` invoked directly — calls the same underlying loader
// programmatically. `process.loadEnvFile` is Node 22+, which `engines` in
// the root `package.json` already requires.
//
// `-if-exists` semantics, done by hand: a missing `.env` (a deployed
// environment, which passes real env vars instead) is not an error, so the
// ENOENT from a fresh clone with no `.env` yet is swallowed. Any other
// failure (a malformed file, a permissions error) is real and should not be
// hidden behind a silent continue.
//
// Precedence is real process env wins over `.env` — this is Node's native
// behaviour, not something this script implements: a variable already set
// in `process.env` before this call is left untouched.
try {
  process.loadEnvFile(path.join(repoRoot, ".env"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const command = process.argv[2] ?? "status";

// Migrations run as the OWNER, never as the runtime app role. DDL needs
// rights the application must not have, which is exactly why they are two
// credentials now (YT-0554, risk 45): `DATABASE_URL` is `yourtal_app` and
// cannot CREATE TABLE, `DATABASE_OWNER_URL` is `yourtal` and is read by
// nothing that serves a request.
//
// Deliberately NOT falling back to `DATABASE_URL` when the owner URL is
// absent. A fallback here would silently re-create the bug this ticket
// exists to fix — a migration quietly running as whatever role happened to
// be configured — and this repo has been bitten enough times by a fallback
// that a person cannot see (docs/13c). Refusing with an instruction is the
// slower path exactly once; a silent fallback is wrong forever.
const databaseUrl = process.env.DATABASE_OWNER_URL;
if (databaseUrl === undefined) {
  console.error(
    "No DATABASE_OWNER_URL. Migrations need the owner credential, not the app role. " +
      "Copy .env.example to .env (it now sets both) and run `pnpm dev:up` from the repo root.",
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
