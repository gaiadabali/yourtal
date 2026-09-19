import type { Region } from "@yourtal/contracts/region";

/**
 * A client-safe mirror of `REGION_CONFIG` from `@yourtal/contracts/region`.
 *
 * Deliberately duplicated rather than value-imported: that module also
 * exports `regionSchema` (a Zod schema), and per
 * docs/13b-typescript-standards.md §8's initial-JS budget, a client-reachable
 * value-import from any `@yourtal/contracts/<entity>` module risks pulling
 * the ~96 KB Zod runtime into the bundle even for an unrelated named export
 * — exactly the failure `money-format.ts` was split out of `money.ts` to
 * avoid (see that file's docstring). `Region` itself is a type-only import,
 * which `verbatimModuleSyntax` erases at compile time, so it is free.
 *
 * These three literals must stay in lockstep with `REGION_CONFIG` in
 * `packages/contracts/src/region/region.ts` — `region-config.test.ts` in
 * this directory imports both (test code is not bundled) and asserts they
 * are identical, so drift fails CI instead of silently reaching a screen.
 */
export interface RegionDisplayConfig {
  readonly locale: "en-AU" | "id-ID";
  readonly currency: "AUD" | "IDR";
  readonly countryName: string;
}

const REGION_DISPLAY_CONFIG: Record<Region, RegionDisplayConfig> = {
  AU: { locale: "en-AU", currency: "AUD", countryName: "Australia" },
  ID: { locale: "id-ID", currency: "IDR", countryName: "Indonesia" },
};

export function regionDisplayConfig(region: Region): RegionDisplayConfig {
  return REGION_DISPLAY_CONFIG[region];
}
