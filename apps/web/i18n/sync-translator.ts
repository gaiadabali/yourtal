import { createTranslator } from "next-intl";
import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";

/**
 * One shared implementation of "a translator callable from a plain
 * synchronous function, with no request scope" — 6.1.a folds this pattern,
 * which used to be hand-rolled per feature (`campaign-i18n.ts`,
 * `nav-i18n.ts`, `checkpoint-i18n.ts`, ... — the audit's "10 createTranslator
 * wrappers"), into one place.
 *
 * `getTranslations()`/`useTranslations()` both need either a live Next.js
 * request (server) or a `NextIntlClientProvider` ancestor (client) to
 * resolve `messages` from `i18n/request.ts`. Neither is available to a
 * plain, synchronous, non-`"use client"` Server Component (Vitest calls
 * those directly, with no request scope) or to a component that must stay
 * usable from a unit test with no provider at all. `createTranslator` is
 * the same primitive next-intl builds both of those on top of; this feeds
 * it catalogues imported directly by the caller, so it stays a pure
 * function with no server-only dependency.
 *
 * Callers still get one small wrapper per namespace (a JSON import needs a
 * static `import` per file, so that much cannot be generalised away), but
 * the wrapper is now one line, not a hand-copied `createTranslator` call.
 *
 * One trade-off: `createTranslator`'s own types walk the SHAPE of
 * `messages` recursively (`NestedKeyOf`/`NestedValueOf` in `use-intl/core`)
 * to type-check every key a caller passes to `t(...)`. That machinery needs
 * a concrete message shape; `Catalogue` here is generic (a different JSON
 * import per namespace), so it cannot resolve, and every attempt to keep it
 * produces a type error from `use-intl` itself, not a real bug in the
 * messages this builds. `LooseTranslator` below and the casts in
 * `translate` opt out of that per-key compile-time check — the same trade
 * `useTranslations(dynamicNamespace)` already makes at runtime. A wrong key
 * still surfaces immediately: `messages-parity.test.ts` guards every
 * catalogue's key set, and a missing key renders visibly empty.
 */
interface LooseTranslator {
  (key: string, values?: Record<string, string | number | Date>): string;
  raw(key: string): unknown;
}

export function makeSyncTranslator<Catalogue>(
  namespace: string,
  catalogues: Record<DisplayLocale, Catalogue>,
): (locale: DisplayLocale) => LooseTranslator {
  return function translate(locale: DisplayLocale) {
    const messages = { [namespace]: catalogues[locale] };
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- `tsc --noEmit` (the project build) DOES require this cast; only eslint's own type-aware pass disagrees, and the build is the one that has to pass.
    return createTranslator({ locale, messages, namespace } as never) as unknown as LooseTranslator;
  };
}
