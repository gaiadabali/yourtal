import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * YT-0400 — proves the acceptance criterion "Contrast checked to WCAG AA
 * on both themes, including the reward and price colours" instead of
 * asserting it in a comment.
 *
 * This parses the *actual* :root (light) block in tokens.css and the two
 * dark-mode blocks in theme.css — the `@media (prefers-color-scheme:
 * dark)` block and the explicit `[data-theme="dark"]` override — then
 * computes WCAG 2.1 relative-luminance contrast ratios for every
 * foreground/background pair a real screen would render. A change to
 * either CSS file that drops a token below AA fails this test.
 */

const stylesDir = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(join(stylesDir, "tokens.css"), "utf-8");
const themeCss = readFileSync(join(stylesDir, "theme.css"), "utf-8");

/** Pulls `--name: value;` declarations out of one `{ ... }` block. */
function parseDeclarations(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const declRe = /--([\w-]+)\s*:\s*([^;]+);/g;
  for (const match of block.matchAll(declRe)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    vars[name] = value.trim();
  }
  return vars;
}

/** Extracts the first `{ ... }` block following a literal selector string. */
function extractBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) {
    throw new Error(`Selector not found: ${selector}`);
  }
  const braceStart = css.indexOf("{", start);
  const braceEnd = css.indexOf("}", braceStart);
  if (braceStart === -1 || braceEnd === -1) {
    throw new Error(`Malformed block for selector: ${selector}`);
  }
  return css.slice(braceStart + 1, braceEnd);
}

const lightVars = parseDeclarations(extractBlock(tokensCss, ":root {"));

const mediaDarkVars = parseDeclarations(
  extractBlock(themeCss, ':root:not([data-theme="light"]) {'),
);
const attrDarkVars = parseDeclarations(
  extractBlock(themeCss, ':root[data-theme="dark"] {'),
);

// Colour tokens that must exist in both dark overrides, per the hard
// interface contract (YT-0400 task brief).
const requiredColorTokens = [
  "color-bg",
  "color-surface",
  "color-surface-raised",
  "color-fg",
  "color-fg-muted",
  "color-fg-subtle",
  "color-border",
  "color-border-strong",
  "color-primary",
  "color-primary-fg",
  "color-reward",
  "color-reward-fg",
  "color-price",
  "color-price-fg",
  "color-success",
  "color-success-fg",
  "color-warning",
  "color-warning-fg",
  "color-danger",
  "color-danger-fg",
  "color-ring",
];

describe("dark mode is wired both ways", () => {
  it("every required colour token resolves on :root (light default)", () => {
    for (const token of requiredColorTokens) {
      expect(lightVars[token], `--${token} missing from tokens.css :root`).toBeDefined();
    }
  });

  it("prefers-color-scheme block overrides every required colour token", () => {
    for (const token of requiredColorTokens) {
      expect(
        mediaDarkVars[token],
        `--${token} missing from @media (prefers-color-scheme: dark) block`,
      ).toBeDefined();
    }
  });

  it('[data-theme="dark"] overrides every required colour token', () => {
    for (const token of requiredColorTokens) {
      expect(
        attrDarkVars[token],
        `--${token} missing from [data-theme="dark"] block`,
      ).toBeDefined();
    }
  });

  it("the media-query and explicit-attribute dark overrides agree", () => {
    for (const token of requiredColorTokens) {
      expect(attrDarkVars[token]).toBe(mediaDarkVars[token]);
    }
  });
});

// Dark theme = light defaults with the explicit [data-theme="dark"]
// overrides layered on top (equivalent to what a browser resolves).
const darkVars: Record<string, string> = { ...lightVars, ...attrDarkVars };

interface Theme {
  name: string;
  vars: Record<string, string>;
}

const themes: Theme[] = [
  { name: "light", vars: lightVars },
  { name: "dark", vars: darkVars },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Expected a 6-digit hex colour, got: ${hex}`);
  }
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function channelLuminance(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 2.1 contrast ratio, always >= 1. */
function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function resolve(vars: Record<string, string>, token: string): string {
  const value = vars[token];
  if (value === undefined) {
    throw new Error(`--${token} is not defined`);
  }
  return value;
}

const TEXT_MIN_RATIO = 4.5;
const BOUNDARY_MIN_RATIO = 3.0;

/** [foreground token, background token] — real text-on-background pairs. */
const textPairs: Array<[string, string]> = [
  ["color-fg", "color-bg"],
  ["color-fg-muted", "color-bg"],
  ["color-fg-subtle", "color-bg"],
  ["color-fg", "color-surface"],
  ["color-fg-muted", "color-surface"],
  ["color-fg-subtle", "color-surface"],
  ["color-fg", "color-surface-raised"],
  ["color-primary-fg", "color-primary"],
  ["color-reward-fg", "color-reward"],
  ["color-price-fg", "color-price"],
  ["color-success-fg", "color-success"],
  ["color-warning-fg", "color-warning"],
  ["color-danger-fg", "color-danger"],
  // Reward and price also render as coloured text directly on the page
  // (e.g. "+50 pts", "Rp 25.000") — checked explicitly per the brief.
  ["color-reward", "color-bg"],
  ["color-reward", "color-surface"],
  ["color-price", "color-bg"],
  ["color-price", "color-surface"],
];

/** [element token, adjacent-surface token] — non-text UI boundaries (WCAG 1.4.11). */
const boundaryPairs: Array<[string, string]> = [
  ["color-border", "color-bg"],
  ["color-border", "color-surface"],
  ["color-border", "color-surface-raised"],
  ["color-border-strong", "color-bg"],
  ["color-border-strong", "color-surface"],
  ["color-border-strong", "color-surface-raised"],
  ["color-primary", "color-bg"],
  ["color-primary", "color-surface"],
  ["color-primary", "color-surface-raised"],
  ["color-ring", "color-bg"],
  ["color-ring", "color-surface"],
  ["color-ring", "color-surface-raised"],
  ["color-danger", "color-bg"],
  ["color-success", "color-bg"],
  ["color-warning", "color-bg"],
  ["color-reward", "color-bg"],
  ["color-price", "color-bg"],
];

describe.each(themes)("WCAG AA contrast — $name theme", ({ vars }) => {
  it.each(textPairs)("text %s on %s >= 4.5:1", (fgToken, bgToken) => {
    const ratio = contrastRatio(resolve(vars, fgToken), resolve(vars, bgToken));
    expect(ratio).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
  });

  it.each(boundaryPairs)("boundary %s vs %s >= 3:1", (fgToken, bgToken) => {
    const ratio = contrastRatio(resolve(vars, fgToken), resolve(vars, bgToken));
    expect(ratio).toBeGreaterThanOrEqual(BOUNDARY_MIN_RATIO);
  });
});

describe("reward and price colours explicitly", () => {
  it.each(themes)("$name: reward-fg on reward and reward-as-text meet AA", ({ name, vars }) => {
    const chip = contrastRatio(resolve(vars, "color-reward-fg"), resolve(vars, "color-reward"));
    const asTextOnBg = contrastRatio(resolve(vars, "color-reward"), resolve(vars, "color-bg"));
    expect(chip, `${name}: reward-fg on reward`).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
    expect(asTextOnBg, `${name}: reward as text on bg`).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
  });

  it.each(themes)("$name: price-fg on price and price-as-text meet AA", ({ name, vars }) => {
    const chip = contrastRatio(resolve(vars, "color-price-fg"), resolve(vars, "color-price"));
    const asTextOnBg = contrastRatio(resolve(vars, "color-price"), resolve(vars, "color-bg"));
    expect(chip, `${name}: price-fg on price`).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
    expect(asTextOnBg, `${name}: price as text on bg`).toBeGreaterThanOrEqual(TEXT_MIN_RATIO);
  });
});
