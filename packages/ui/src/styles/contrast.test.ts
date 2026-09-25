import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * WCAG 2.1 contrast for every token pair a screen can put together, on every
 * surface, in both themes. Values are resolved from tokens.css itself, through
 * light-dark() and var(), down to the raw palette.
 */

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tokens.css"), "utf-8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const body = css.slice(open + 1, css.indexOf("}", open)).replace(/\/\*[\s\S]*?\*\//g, "");
  const vars: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    if (name && value) vars[name] = value.replace(/\s+/g, " ").trim();
  }
  return vars;
}

const raw = block(":root {");
const aliases = block(":root,\n[data-surface] {");
const SURFACES = {
  viewer: block(':root,\n[data-surface="viewer"] {'),
  studio: block('[data-surface="studio"] {'),
  counter: block('[data-surface="counter"] {'),
} as const;
type Surface = keyof typeof SURFACES;
type Theme = "light" | "dark";

function resolve(value: string, surface: Surface, theme: Theme, depth = 0): string {
  if (depth > 8) throw new Error(`Reference loop at ${value}`);
  const lightDark = /^light-dark\((.+),\s*(var\([^)]+\)|#[0-9a-f]{6})\)$/i.exec(value);
  if (lightDark?.[1] && lightDark[2]) {
    return resolve(theme === "light" ? lightDark[1] : lightDark[2], surface, theme, depth + 1);
  }
  const ref = /^var\(--([\w-]+)\)$/.exec(value);
  if (ref?.[1]) {
    const name = ref[1];
    const next = SURFACES[surface][name] ?? aliases[name] ?? raw[name];
    if (next === undefined) throw new Error(`Unknown token --${name}`);
    return resolve(next, surface, theme, depth + 1);
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Not a colour: ${value}`);
  return value;
}

function color(token: string, surface: Surface, theme: Theme): string {
  return resolve(`var(--color-${token})`, surface, theme);
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SEMANTIC = [
  "canvas",
  "surface",
  "surface-sunken",
  "overlay",
  "fg",
  "fg-muted",
  "fg-subtle",
  "fg-on-accent",
  "fg-on-points",
  "fg-on-status",
  "border-subtle",
  "border-control",
  "border-strong",
  "accent",
  "accent-hover",
  "accent-subtle",
  "points",
  "points-subtle",
  "focus",
  ...["success", "warning", "danger", "info"].flatMap((s) => [
    `${s}-solid`,
    `${s}-subtle`,
    `${s}-on-subtle`,
  ]),
];

const BACKGROUNDS = ["canvas", "surface", "surface-sunken"];
const STATUSES = ["success", "warning", "danger", "info"];

/** [foreground, background, minimum] */
function pairs(surface: Surface): [string, string, number][] {
  const text = surface === "counter" ? 7 : 4.5; // the counter is read at arm's length
  return [
    ...BACKGROUNDS.flatMap((bg): [string, string, number][] => [
      ["fg", bg, text],
      ["fg-muted", bg, text],
      ["fg-subtle", bg, text],
      ["accent", bg, 4.5],
      ["border-control", bg, 3],
      ["focus", bg, 3],
      ...STATUSES.map((s): [string, string, number] => [`${s}-solid`, bg, 4.5]),
    ]),
    ["fg-on-accent", "accent", 4.5],
    ["fg-on-accent", "accent-hover", 4.5],
    ["fg", "accent-subtle", 4.5],
    ["fg-on-points", "points", 4.5],
    ["fg", "points-subtle", 4.5],
    ...STATUSES.flatMap((s): [string, string, number][] => [
      ["fg-on-status", `${s}-solid`, 4.5],
      [`${s}-on-subtle`, `${s}-subtle`, 4.5],
    ]),
    // v1 aliases, still used by screens that have not moved over.
    ["fg", "surface-raised", text],
    ["fg-muted", "surface-raised", 4.5],
    ["reward", "canvas", 4.5],
    ["reward-fg", "reward", 4.5],
    ["price", "canvas", 4.5],
    ["price-fg", "price", 4.5],
  ];
}

describe("tokens v2", () => {
  for (const surface of Object.keys(SURFACES) as Surface[]) {
    it(`${surface} defines every semantic token`, () => {
      const missing = SEMANTIC.filter((t) => SURFACES[surface][`color-${t}`] === undefined);
      expect(missing).toStrictEqual([]);
    });

    it(`${surface} semantics reference the palette, never a raw hex`, () => {
      const hex = Object.entries(SURFACES[surface]).filter(([, v]) => /#[0-9a-f]{3,8}\b/i.test(v));
      expect(hex).toStrictEqual([]);
    });

    for (const theme of ["light", "dark"] as const) {
      it(`${surface} ${theme}: every pair meets its minimum`, () => {
        const failures = pairs(surface).flatMap(([fg, bg, min]) => {
          const r = ratio(color(fg, surface, theme), color(bg, surface, theme));
          return r < min ? [`${fg} on ${bg}: ${r.toFixed(2)} < ${min}`] : [];
        });
        expect(failures).toStrictEqual([]);
      });
    }
  }

  it("points gold is never a text colour on a light surface", () => {
    for (const surface of Object.keys(SURFACES) as Surface[]) {
      const gold = color("points", surface, "light");
      expect(ratio(gold, color("canvas", surface, "light"))).toBeLessThan(4.5);
    }
  });
});
