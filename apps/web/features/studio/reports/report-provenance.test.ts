import { describe, expect, it } from "vitest";
import { getStudioTranslator } from "../studio-i18n";
import { REPORT_PROVENANCE_LEVELS } from "./report-provenance";

describe("report-provenance", () => {
  it.each(["en-AU", "id-ID"] as const)(
    "has both a label and a non-empty explanation for every level in %s",
    (locale) => {
      const t = getStudioTranslator(locale);
      for (const level of REPORT_PROVENANCE_LEVELS) {
        expect(t(`reports.provenance.label.${level}`)).not.toContain("reports.provenance");
        expect(t(`reports.provenance.explanation.${level}`).length).toBeGreaterThan(20);
      }
    },
  );

  it("never offers a 'verified' tier — the whole point of this vocabulary (docs/23 §1.0)", () => {
    const t = getStudioTranslator("en-AU");
    for (const level of REPORT_PROVENANCE_LEVELS) {
      expect(level).not.toBe("verified");
      expect(t(`reports.provenance.label.${level}`).toLowerCase()).not.toContain("verified");
    }
  });
});
