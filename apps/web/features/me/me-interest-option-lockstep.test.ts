import { describe, expect, it } from "vitest";
import { INTEREST_OPTIONS } from "@/features/onboarding/interest-option";
import { ME_INTEREST_OPTIONS } from "./me-interest-option";

/**
 * `me-interest-option.ts` deliberately duplicates onboarding's interest
 * catalogue instead of importing it (see that file's docstring). This test
 * is the drift guard, exactly like `features/region/region-config.test.ts`
 * guards its own duplicated mirror of `REGION_CONFIG`: it runs as plain
 * Node test code, never bundled for the browser, so it is free to import
 * the real onboarding module and prove the two catalogues have not
 * diverged — same ids in the same order, same bilingual labels, same tint.
 * If this ever fails, `me-interest-option.ts` needs updating to match,
 * never the other way around: onboarding owns the source of truth.
 */
describe("features/me's mirror of onboarding's interest catalogue", () => {
  it("has the same ids, in the same order, as onboarding", () => {
    expect(ME_INTEREST_OPTIONS.map((option) => option.id)).toEqual(
      INTEREST_OPTIONS.map((option) => option.id),
    );
  });

  it.each(INTEREST_OPTIONS.map((option) => option.id))(
    "matches onboarding's labels and tint for %s",
    (id) => {
      const source = INTEREST_OPTIONS.find((option) => option.id === id);
      const mirror = ME_INTEREST_OPTIONS.find((option) => option.id === id);
      expect(mirror?.labelEn).toBe(source?.labelEn);
      expect(mirror?.labelId).toBe(source?.labelId);
      expect(mirror?.tint).toBe(source?.tint);
    },
  );
});
