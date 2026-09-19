import { describe, expect, it } from "vitest";
import { REGION_CONFIG, regionSchema } from "@yourtal/contracts/region";
import { regionDisplayConfig } from "./region-config";

/**
 * `region-config.ts` deliberately duplicates `REGION_CONFIG` instead of
 * value-importing it (see that file's docstring — the value-import would
 * risk pulling Zod into the client bundle). This test is the drift guard
 * for that duplication: it runs as plain Node test code, never bundled for
 * the browser, so it is free to import the real contracts module and prove
 * the mirror has not diverged.
 */
describe("features/region's client-safe mirror of REGION_CONFIG", () => {
  it.each(regionSchema.options)("matches the contract for %s exactly", (region) => {
    expect(regionDisplayConfig(region)).toEqual(REGION_CONFIG[region]);
  });
});
