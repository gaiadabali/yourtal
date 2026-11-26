import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** BUILD.md T3 done-when (3): the classifier does no I/O, so its imports are fenced. */
const ALLOWED = new Set(["tldts", "node:url"]);
const dir = fileURLToPath(new URL(".", import.meta.url));
const sources = [
  ...readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")),
  ...readdirSync(join(dir, "fixtures")).map((f) => `fixtures/${f}`),
];

describe("classify imports", () => {
  it.each(sources)("%s imports only pure modules", (file) => {
    const text = readFileSync(join(dir, file), "utf8");
    const specifiers = [...text.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
    for (const s of specifiers) {
      // A relative import must stay inside classify/.
      const inside = s.startsWith(".") && resolve(dirname(join(dir, file)), s).startsWith(dir);
      expect(inside || ALLOWED.has(s), `${file}: ${s}`).toBe(true);
    }
    expect(text).not.toMatch(/\b(?:require|import)\s*\(/);
    expect(text).not.toMatch(/\b(?:process|fetch|globalThis|Date\.now|Math\.random)\b/);
  });

  it("covers every source file", () => {
    expect(sources.length).toBeGreaterThanOrEqual(10);
  });
});
