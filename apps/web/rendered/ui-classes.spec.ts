import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_SRC = path.resolve(WEB, "../../packages/ui/src");

const CLASS_SELECTOR = /\.((?:\\[0-9a-fA-F]{1,6}\s?|\\[^\n]|[\w\u0080-￿-])+)/g;

function unescapeCss(raw: string): string {
  return raw
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/\\(.)/g, "$1");
}

/** Class names as written in the built CSS, with CSS escapes undone. */
function builtClassNames(): Set<string> {
  const dir = path.join(WEB, ".next/static");
  const css = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(path.join(dir, file), "utf8"))
    .join("\n");
  return new Set([...css.matchAll(CLASS_SELECTOR)].map(([, raw]) => unescapeCss(raw ?? "")));
}

// The failure this catches: Tailwind never scanned packages/ui, so its classes were
// silently absent and dialogs opened off-screen.
test("every class Tailwind finds in packages/ui is in the built CSS", async () => {
  const candidates = new Scanner({
    sources: [{ base: UI_SRC, pattern: "**/*", negated: false }],
  }).scan();
  const globals = readFileSync(path.join(WEB, "app/globals.css"), "utf8");
  const design = await __unstable__loadDesignSystem(globals, { base: path.join(WEB, "app") });
  const css = design.candidatesToCss(candidates);
  const utilities = candidates.filter((_, i) => css[i] != null);
  expect(utilities.length, "the scan found the primitives' utilities").toBeGreaterThan(100);

  const built = builtClassNames();
  expect(utilities.filter((name) => !built.has(name))).toStrictEqual([]);
});
