import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * YT-0058 AC3: "missing-translation check fails the build." Every feature
 * namespace ships one JSON catalogue per locale (`messages/<locale>/
 * <feature>.json`), each read directly by its own synchronous translator
 * (`features/<domain>/<domain>-i18n.ts`, per campaign-i18n.ts's doc
 * comment) — next-intl itself only ever sees the subset registered in
 * `i18n/request.ts`'s `FeatureNamespace` union, so it cannot catch a key
 * missing from the OTHER locale's file for an unregistered namespace, and
 * nothing else in this repo checked that either. A key present in one
 * locale and silently absent from the other renders as next-intl's raw
 * `{key}` fallback in production for whichever region hits it first —
 * exactly the "no hard-coded / no missing string" gap this ticket exists
 * to close, just discovered by a user instead of by CI.
 *
 * This is a plain Vitest test rather than a new root-level script so it
 * runs everywhere `vitest run` already does (CI gate 8, docs/13-engineering-
 * standards.md §7) with no separate wiring to forget.
 */

const LOCALES = ["en-AU", "id-ID"] as const;
const MESSAGES_DIR = path.dirname(fileURLToPath(import.meta.url));

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue };

/** Flattens a nested catalogue into dotted key paths, e.g. `card.upToReward`. */
function flattenKeys(value: JsonValue, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function listCatalogueFiles(locale: string): string[] {
  return readdirSync(path.join(MESSAGES_DIR, locale))
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function readCatalogue(locale: string, filename: string): JsonValue {
  const raw = readFileSync(path.join(MESSAGES_DIR, locale, filename), "utf8");
  return JSON.parse(raw) as JsonValue;
}

describe("message catalogues stay in lockstep across locales (YT-0058 AC3)", () => {
  const [baseLocale, ...otherLocales] = LOCALES;
  const baseFiles = listCatalogueFiles(baseLocale);

  it("every feature namespace ships a catalogue for every locale", () => {
    for (const locale of otherLocales) {
      expect(listCatalogueFiles(locale), `catalogue files for ${locale}`).toStrictEqual(baseFiles);
    }
  });

  for (const filename of baseFiles) {
    it.each(otherLocales)(
      `%s/${filename} has exactly the same keys as ${baseLocale}/${filename}`,
      (locale) => {
        const baseKeys = new Set(flattenKeys(readCatalogue(baseLocale, filename)));
        const localeKeys = new Set(flattenKeys(readCatalogue(locale, filename)));

        const missing = [...baseKeys].filter((key) => !localeKeys.has(key));
        const extra = [...localeKeys].filter((key) => !baseKeys.has(key));

        expect(
          missing,
          `${locale}/${filename} is missing keys present in ${baseLocale}: ${missing.join(", ")}`,
        ).toStrictEqual([]);
        expect(
          extra,
          `${locale}/${filename} has keys not present in ${baseLocale}: ${extra.join(", ")}`,
        ).toStrictEqual([]);
      },
    );
  }
});
