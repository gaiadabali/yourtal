#!/usr/bin/env node
// Generates Go types from the SAME OpenAPI document the TypeScript side uses.
// YT-0031 AC2.
//
//   node openapi/generate-go.mjs            regenerate go/ in place
//   node openapi/generate-go.mjs --check    fail if go/ is stale   (CI gate)
//   node openapi/generate-go.mjs --verify   go build + go vet it   (CI gate)
//
// --verify exists because generated code that does not compile looks exactly
// like generated code that does. Two defects got through review and were only
// caught by actually building it: colliding enum constants (see
// enumClassPrefix below) and a missing utils.go. Neither is visible by reading
// the diff.
//
// ## Why openapi-generator and not oapi-codegen
//
// oapi-codegen is the more idiomatic Go tool and it was tried first. It parses
// specs with kin-openapi, which implements **OpenAPI 3.0 only**, and it fails
// outright on our document:
//
//   json: cannot unmarshal number into field Schema.exclusiveMinimum of type bool
//
// That is the 3.0-vs-3.1 difference — 3.0 spells `exclusiveMinimum` as a
// boolean flag, 3.1 (JSON Schema 2020-12) spells it as the number itself. The
// alternative was to emit a lossy 3.0 variant of the document just for Go,
// which would mean two documents that can disagree while both drift checks
// pass. A second source of truth to serve a tool is the precise thing YT-0031
// exists to prevent, so the tool changed instead.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const GENERATOR_IMAGE =
  "openapitools/openapi-generator-cli:v7.25.0@sha256:2ab0a9680222de65dc9d3baf861aa02b99e1b80c211d8221ebf3ae8f8a102524";

const openapiDir = path.dirname(fileURLToPath(import.meta.url));
const goDir = path.join(openapiDir, "go");
const scratchDir = path.join(openapiDir, ".gotmp");

const checkOnly = process.argv.includes("--check");
const verifyOnly = process.argv.includes("--verify");

const GO_IMAGE =
  "golang:1.26.8-alpine3.24@sha256:8ac98ca534ac3f51e1f420a1dd2c15e74c75cfa0f23f3ad27eb5d7236c349a0c";

if (verifyOnly) {
  // Copied out of the read-only mount because `go mod tidy` writes go.sum.
  const verify = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${goDir}:/src:ro`,
      GO_IMAGE,
      "sh",
      "-c",
      "mkdir -p /b && cp /src/* /b/ && cd /b && go mod tidy && go build ./... && go vet ./...",
    ],
    { stdio: "inherit", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  );

  if (verify.error) {
    console.error(`\nCould not run Docker: ${verify.error.message}`);
    process.exit(1);
  }
  if (verify.status !== 0) {
    console.error("\nThe generated Go does not build. Do not ship it.");
    process.exit(verify.status ?? 1);
  }
  console.log("Generated Go builds and vets clean.");
  process.exit(0);
}

rmSync(scratchDir, { recursive: true, force: true });

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    // Run as the calling user on Linux. By default the container writes as
    // root, so the generated tree — including `.gotmp/.openapi-generator` —
    // comes back root-owned and the caller cannot delete it. The FIRST CI run
    // of this workflow died on exactly that: `EACCES: permission denied,
    // rmdir '.../.gotmp/.openapi-generator'`.
    //
    // It cannot reproduce on the machine this was written on: Docker Desktop
    // on Windows and macOS maps ownership to the host user for bind mounts,
    // and `process.getuid` does not exist there at all — which is why the
    // guard is a feature check rather than a platform string.
    ...(typeof process.getuid === "function"
      ? ["--user", `${process.getuid()}:${process.getgid()}`]
      : []),
    "-v",
    `${openapiDir}:/local`,
    GENERATOR_IMAGE,
    "generate",
    "-i",
    "/local/yourtal.openapi.json",
    "-o",
    "/local/.gotmp",
    "-g",
    "go",
    // Models, plus exactly one supporting file. There are no paths yet, so a
    // full client would be an empty shell wrapped in HTTP plumbing nobody
    // asked for — but the models do not compile alone: every generated struct
    // asserts it implements `MappedNullable`, which is declared in utils.go.
    //     vet: model_balance.go:20:7: undefined: MappedNullable
    "--global-property",
    "models,supportingFiles=utils.go",
    // enumClassPrefix is NOT optional. Without it the generator names every
    // enum constant after the bare value, so `CampaignStatus` and
    // `VoucherStatus` both declare `ACTIVE` at package scope and the output
    // does not compile:
    //     vet: model_voucher_status.go:23:2: ACTIVE redeclared in this block
    // With it they become CAMPAIGNSTATUS_ACTIVE and VOUCHERSTATUS_ACTIVE.
    // This is why CI compiles the generated Go rather than trusting it.
    "--additional-properties=packageName=contracts,withGoMod=false,enumClassPrefix=true",
  ],
  { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
);

if (result.error) {
  console.error(
    `\nCould not run Docker: ${result.error.message}\n` +
      `Go type generation needs Docker to run ${GENERATOR_IMAGE}.\n`,
  );
  process.exit(1);
}
if (result.status !== 0) {
  console.error("\nopenapi-generator failed.");
  process.exit(result.status ?? 1);
}

// The generator also writes docs/, .openapi-generator/ and a README whose
// content changes with the generator's own version. Keeping only the .go files
// means a generator upgrade shows up as a type change or nothing at all,
// rather than as a hundred lines of unrelated churn in review.
const generated = readdirSync(scratchDir)
  .filter((name) => name.endsWith(".go"))
  .sort();
if (generated.length === 0) {
  console.error("\nopenapi-generator produced no Go files.");
  process.exit(1);
}

if (checkOnly) {
  const stale = generated.filter(
    (name) =>
      !existsSync(path.join(goDir, name)) ||
      readFileSync(path.join(goDir, name), "utf8") !==
        readFileSync(path.join(scratchDir, name), "utf8"),
  );
  const removed = existsSync(goDir)
    ? readdirSync(goDir).filter((name) => name.endsWith(".go") && !generated.includes(name))
    : [];

  rmSync(scratchDir, { recursive: true, force: true });

  if (stale.length > 0 || removed.length > 0) {
    console.error(
      "\nThe generated Go types are stale.\n" +
        (stale.length > 0 ? `  changed: ${stale.join(", ")}\n` : "") +
        (removed.length > 0 ? `  no longer generated: ${removed.join(", ")}\n` : "") +
        "\nRun `pnpm --filter @yourtal/contracts openapi:go` and commit the result.\n",
    );
    process.exit(1);
  }
  console.log(`Go types are up to date (${String(generated.length)} files).`);
  process.exit(0);
}

// Remove the previously generated .go files only — go.mod is hand-written and
// deliberately NOT generated, so wiping the directory would delete it and the
// module would stop building with no obvious cause.
mkdirSync(goDir, { recursive: true });
for (const name of readdirSync(goDir)) {
  if (name.endsWith(".go")) rmSync(path.join(goDir, name));
}
for (const name of generated) {
  cpSync(path.join(scratchDir, name), path.join(goDir, name));
}
rmSync(scratchDir, { recursive: true, force: true });

console.log(`Wrote ${String(generated.length)} Go files to openapi/go/.`);
