#!/usr/bin/env node
// Builds apps/api or apps/worker into <app>/dist for the Helios artifact (2.1.b).
//
// Not plain `tsc`: every @yourtal/* package exports raw .ts, so compiled app
// code would still import .ts at runtime. esbuild bundles those packages in and
// leaves npm dependencies external (installed by `pnpm deploy`). swc does the
// per-file transform because esbuild cannot emit the decorator metadata NestJS
// DI reads.
//
//   node scripts/build-service.mjs api|worker
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { transform } from "@swc/core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = process.argv[2];
if (app !== "api" && app !== "worker") {
  console.error("usage: build-service.mjs api|worker");
  process.exit(2);
}
const appDir = path.join(root, "apps", app);
const outdir = path.join(appDir, "dist");

// The worker discovers jobs by scanning dist/jobs at boot, so each job file
// stays its own entry point instead of being folded into main.js.
const entryPoints = { main: path.join(appDir, "src/main.ts") };
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

rmSync(outdir, { recursive: true, force: true });
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
