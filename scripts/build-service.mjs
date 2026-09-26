#!/usr/bin/env node
// Builds apps/api, apps/worker, or the staging seed CLI, for the Helios
// artifact (2.1.b, 2.3.e).
//
// Not plain `tsc`: every @yourtal/* package exports raw .ts, so compiled app
// code would still import .ts at runtime. esbuild bundles those packages in and
// leaves npm dependencies external (installed by `pnpm deploy`). swc does the
// per-file transform because esbuild cannot emit the decorator metadata NestJS
// DI reads.
//
//   node scripts/build-service.mjs api|worker|seed
//
// ORDER MATTERS: run `api` before `seed`, never after — `api`'s own build
// clears the whole `apps/api/dist` directory first (see the `rmSync` guard
// below), and `seed` builds into that same directory without clearing it.
// Building `api` second would delete `seed-staging.js` right back out.
//
// `seed` is `packages/db/src/seed/main-staging.ts` (2.3.e), built into
// `apps/api/dist` — the SAME output directory as `api`, not a `packages/db`
// dist of its own. Deliberately: the Helios release's `node_modules` lives
// under `apps/api` (this task's own instructions), and this bundle's
// external npm dependencies — `pg`, and `@node-rs/argon2`, a native addon
// esbuild can reference but never actually bundle — have to resolve from
// SOMEWHERE real at runtime. `apps/api/node_modules` already has both,
// because `main.js` needs them too. A `packages/db/dist-seed` with no
// `node_modules` of its own on the deployed box would be a script that only
// runs on a machine with the whole monorepo checked out — exactly what this
// artifact is not.
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { transform } from "@swc/core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = process.argv[2];
if (app !== "api" && app !== "worker" && app !== "seed") {
  console.error("usage: build-service.mjs api|worker|seed");
  process.exit(2);
}

const appDir = path.join(root, "apps", app === "seed" ? "api" : app);
const outdir = path.join(appDir, "dist");

const entryPoints =
  app === "seed"
    ? { "seed-staging": path.join(root, "packages/db/src/seed/main-staging.ts") }
    : { main: path.join(appDir, "src/main.ts") };
// The worker discovers jobs by scanning dist/jobs at boot, so each job file
// stays its own entry point instead of being folded into main.js.
if (app === "worker") {
  for (const f of readdirSync(path.join(appDir, "src/jobs"))) {
    if (f.endsWith(".ts") && !f.endsWith(".test.ts")) {
      entryPoints[`jobs/${f.slice(0, -3)}`] = path.join(appDir, "src/jobs", f);
    }
  }
}

const swcDecorators = {
  name: "swc-decorators",
  setup(b) {
    b.onLoad({ filter: /\.ts$/ }, async (args) => {
      const { readFile } = await import("node:fs/promises");
      const source = await readFile(args.path, "utf8");
      const out = await transform(source, {
        filename: args.path,
        sourceMaps: "inline",
        jsc: {
          parser: { syntax: "typescript", decorators: true },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
            useDefineForClassFields: false,
          },
          target: "es2023",
          keepClassNames: true,
        },
        module: { type: "es6" },
      });
      return { contents: out.code, loader: "js" };
    });
  },
};

// Everything that is not a workspace package or a relative path stays external.
const externalNpm = {
  name: "external-npm",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      args.kind === "entry-point" || path.isAbsolute(args.path) || args.path.startsWith("@yourtal/")
        ? undefined
        : { path: args.path, external: true },
    );
  },
};

// `seed` shares `api`'s outdir on purpose (see the header above) — wiping
// it here would delete `main.js` if `api` already built into it, or a
// later `api` build would delete `seed-staging.js` right back. Only the
// build that OWNS its outdir exclusively (api, worker, each building
// their own app fresh) clears it first.
if (app !== "seed") rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints,
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: true,
  chunkNames: "chunks/[name]-[hash]",
  plugins: [externalNpm, swcDecorators],
  logLevel: "info",
});
