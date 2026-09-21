import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Every package `apps/web` imports must be declared in its own
 * `package.json` (YT-0512).
 *
 * ## Why this is a test and not a convention
 *
 * An undeclared import usually still *works*, which is the whole problem.
 * pnpm's store leaves transitive dependencies resolvable from disk, so a
 * package that some other dependency happens to pull in imports cleanly,
 * typechecks, builds and ships — until the day that intermediate dependency
 * drops it or moves it behind a different version, and the failure lands on
 * whoever is deploying rather than on whoever wrote the import.
 *
 * `.npmrc` hoists only eslint and prettier, so this app is mostly protected
 * by pnpm's strictness. "Mostly" is the gap this closes.
 *
 * It is not hypothetical. This test was written for a ticket about six
 * console files importing an undeclared `@yourtal/authz` — stale by the time
 * it was read, those files were gone — and while verifying that, it found a
 * live one: `scripts/build-service-worker.mjs` imported `@serwist/build`,
 * resolvable only as a transitive of `@serwist/next`, introduced hours
 * earlier by the same session that then fixed it.
 *
 * ## Scope
 *
 * Static specifiers only. A fully dynamic `import(someVariable)` cannot be
 * resolved by reading source and is out of scope; nothing in this app uses
 * one today.
 */

const APP_DIR = path.resolve(import.meta.dirname);
const SKIP_DIRS = new Set([".next", "node_modules", "test-results", "playwright-report"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

/**
 * Anchored to real import syntax rather than "any quoted string". An earlier
 * loose scan reported `holdback_blocks` and `jumped` as packages — they are
 * values in object literals — which is the kind of false positive that gets
 * a guard switched off rather than fixed.
 */
const SPECIFIER_PATTERNS = [
  /(?:^|[\s;}])import\s+[^"';]*?from\s+"([^"]+)"/g,
  /(?:^|[\s;}])import\s+"([^"]+)"/g,
  /(?:^|[\s;}])export\s+[^"';]*?from\s+"([^"]+)"/g,
  /\bimport\(\s*"([^"]+)"\s*\)/g,
  /\brequire\(\s*"([^"]+)"\s*\)/g,
];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...(await sourceFiles(path.join(dir, entry.name))));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/** `@scope/name/deep/path` -> `@scope/name`; `name/deep` -> `name`. */
function packageNameOf(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0]!;
}

function isExternalPackage(specifier: string): boolean {
  if (specifier.startsWith(".")) return false; // relative
  if (specifier.startsWith("@/")) return false; // this app's own tsconfig alias
  if (specifier.startsWith("node:")) return false; // node builtin
  return true;
}

describe("apps/web dependency declarations (YT-0512)", () => {
  it("declares every package it imports", async () => {
    const manifest: unknown = JSON.parse(readFileSync(path.join(APP_DIR, "package.json"), "utf8"));
    const { dependencies = {}, devDependencies = {} } = manifest as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)]);

    const undeclared = new Map<string, string[]>();
    for (const file of await sourceFiles(APP_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const pattern of SPECIFIER_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
          const specifier = match[1]!;
          if (!isExternalPackage(specifier)) continue;
          const name = packageNameOf(specifier);
          if (declared.has(name)) continue;
          const relative = path.relative(APP_DIR, file).replaceAll("\\", "/");
          undeclared.set(name, [...(undeclared.get(name) ?? []), relative]);
        }
      }
    }

    // Named, not just counted: a failure should say which package and which
    // file, so the fix is `pnpm add` and not an investigation.
    expect(
      Object.fromEntries([...undeclared].map(([name, files]) => [name, [...new Set(files)]])),
    ).toEqual({});
  });
});
