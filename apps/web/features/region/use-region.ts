"use client";

import { useContext } from "react";
import type { Region } from "@yourtal/contracts/region";
import { RegionContext } from "./region-context";
import { regionDisplayConfig } from "./region-config";

export interface UseRegionResult {
  readonly region: Region;
  readonly locale: "en-AU" | "id-ID";
  readonly currency: "AUD" | "IDR";
  readonly countryName: string;
}

/**
 * Reads the ambient region set by the nearest `RegionProvider`, plus its
 * display config — the single call a Client Component needs to keep
 * currency, number formatting and copy wired to the same value (YT-0405
 * acceptance: "switching region changes currency, number formatting and
 * copy together").
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
