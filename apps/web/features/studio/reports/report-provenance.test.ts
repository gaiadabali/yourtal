import { describe, expect, it } from "vitest";
import {
  PROVENANCE_EXPLANATION,
  PROVENANCE_LABEL,
  REPORT_PROVENANCE_LEVELS,
} from "./report-provenance";

describe("report-provenance", () => {
  it.each(REPORT_PROVENANCE_LEVELS)(
    "has both a label and a non-empty explanation for %s",
    (level) => {
      expect(PROVENANCE_LABEL[level]).toBeTruthy();
      expect(PROVENANCE_EXPLANATION[level]).toBeTruthy();
      expect(PROVENANCE_EXPLANATION[level].length).toBeGreaterThan(20);
    },
  );

  it("never offers a 'verified' tier — the whole point of this vocabulary (docs/23 §1.0)", () => {
    for (const level of REPORT_PROVENANCE_LEVELS) {
      expect(level).not.toBe("verified");
      expect(PROVENANCE_LABEL[level].toLowerCase()).not.toContain("verified");
    }
  });
});
