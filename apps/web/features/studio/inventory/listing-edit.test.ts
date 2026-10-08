import { describe, expect, it } from "vitest";
import { buildListingEditPatch, editValuesFor, localDay } from "./listing-edit";

const NOW = new Date("2026-10-08T10:00:00");
const ORIGINAL = {
  title: "Flat white",
  stockTotal: 5,
  expiresAt: new Date("2027-01-15T23:59:59").toISOString(),
};

describe("editValuesFor", () => {
  it("shows the stored day in the browser's own calendar", () => {
    expect(editValuesFor(ORIGINAL)).toEqual({
      title: "Flat white",
      stockTotal: "5",
      expiresOn: "2027-01-15",
    });
    expect(localDay(ORIGINAL.expiresAt)).toBe("2027-01-15");
  });
});

describe("buildListingEditPatch", () => {
  it("sends only what changed, and never a price", () => {
    const result = buildListingEditPatch(
      { ...editValuesFor(ORIGINAL), title: "  Flat white, large  ", stockTotal: "8" },
      ORIGINAL,
      NOW,
    );
    expect(result).toEqual({ ok: true, patch: { title: "Flat white, large", stockTotal: 8 } });
  });

  it("turns a new day into the end of that day, and leaves an untouched day alone", () => {
    const moved = buildListingEditPatch(
      { ...editValuesFor(ORIGINAL), expiresOn: "2027-03-01" },
      ORIGINAL,
      NOW,
    );
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(localDay(moved.patch.expiresAt ?? "")).toBe("2027-03-01");
      expect(Object.keys(moved.patch)).toEqual(["expiresAt"]);
    }
    const untouched = buildListingEditPatch(editValuesFor(ORIGINAL), ORIGINAL, NOW);
    expect(untouched).toEqual({ ok: false, errors: {}, unchanged: true });
  });

  it("refuses an empty title, a stock below one and a day that has passed", () => {
    const result = buildListingEditPatch(
      { title: "   ", stockTotal: "0", expiresOn: "2026-01-01" },
      ORIGINAL,
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      unchanged: false,
      errors: { title: "required", stockTotal: "stock", expiresOn: "expiry" },
    });
  });

  it("refuses a stock that is not a whole number", () => {
    for (const stockTotal of ["1.5", "-3", "ten", ""]) {
      const result = buildListingEditPatch(
        { ...editValuesFor(ORIGINAL), stockTotal },
        ORIGINAL,
        NOW,
      );
      expect(result).toMatchObject({ ok: false, errors: { stockTotal: "stock" } });
    }
  });
});
