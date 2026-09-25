import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every `messages/<locale>/*.json` must exist in every locale with the same keys.
 * i18n/request.ts loads whatever this folder holds, so a missing key would render
 * as a raw `{key}` for one region instead of failing CI.
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

describe("message catalogues stay in lockstep across locales", () => {
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
