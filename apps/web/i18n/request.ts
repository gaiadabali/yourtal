import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getRequestConfig } from "next-intl/server";
import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { getDisplayLocale } from "./get-locale";

type Locale = DisplayLocale;
type Messages = Record<string, Record<string, unknown>>;

// Every `messages/<locale>/<namespace>.json` that exists is loaded, so an area can add
// its own catalogue without touching this file. The parity test globs the same folder.
// Standalone builds ship the folder via `outputFileTracingIncludes` in next.config.ts.
const MESSAGES_DIR = path.join(process.cwd(), "messages");

const cache = new Map<Locale, Promise<Messages>>();

async function readCatalogues(locale: Locale): Promise<Messages> {
  const dir = path.join(MESSAGES_DIR, locale);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const entries = await Promise.all(
    files.map(async (name) => {
      const json = JSON.parse(await readFile(path.join(dir, name), "utf8")) as Record<
        string,
        unknown
      >;
      return [name.slice(0, -".json".length), json] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function loadMessages(locale: Locale): Promise<Messages> {
  // Re-read in dev so catalogue edits show without a restart.
  if (process.env.NODE_ENV === "development") return readCatalogues(locale);
  let pending = cache.get(locale);
  if (!pending) {
    pending = readCatalogues(locale);
    cache.set(locale, pending);
  }
  return pending;
}

export default getRequestConfig(async () => {
  // 6.1.b: display language, read independently of region — never
  // derived from `yt_region` (F2).
  const locale = await getDisplayLocale();
  return { locale, messages: await loadMessages(locale) };
});
