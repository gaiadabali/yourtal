"use client";

import { useContext } from "react";
import type { Region } from "@yourtal/contracts/region";
import { RegionContext } from "./region-context";
import { regionDisplayConfig } from "./region-config";

export interface UseRegionResult {
  readonly region: Region;
  /**
   * The region's OWN default locale — not necessarily the viewer's actual
   * display language (6.1.b, F2: display language is independent of
   * region). Use this only where a copy genuinely has no other locale to
   * fall back to (region-config's own drift test, a region-only preview).
   * A screen rendering user-facing copy should call `useLocale()` (from
   * `next-intl`) instead, which reflects `yt_locale` — see
   * `apps/web/i18n/get-locale.ts` for the server-side equivalent.
   */
  readonly locale: "en-AU" | "id-ID";
  readonly currency: "AUD" | "IDR";
  readonly countryName: string;
}

/**
 * Reads the ambient region set by the nearest `RegionProvider`, plus its
 * display config — the single call a Client Component needs for currency
 * and region-scoped facts. `locale` here is the region's default, not the
 * account's display-language choice (see that field's own doc comment).
 *
 * Throws outside a `RegionProvider` rather than defaulting, so a missing
 * provider is a loud bug, not a screen quietly rendering the wrong region.
 */
export function useRegion(): UseRegionResult {
  const region = useContext(RegionContext);
  if (region === null) {
    throw new Error("useRegion() was called outside a RegionProvider");
  }
  return { region, ...regionDisplayConfig(region) };
}
