import { describe, expect, it } from "vitest";
import { listingStatusPresentation } from "./store-status";

describe("listingStatusPresentation", () => {
  it("returns null for the unbadged available state", () => {
    expect(listingStatusPresentation("available")).toBeNull();
  });

  it("badges sold_out as a danger 'Habis' state", () => {
    expect(listingStatusPresentation("sold_out")).toEqual({ label: "Habis", badgeVariant: "danger" });
  });

  it("badges expiring_soon as a warning state", () => {
    expect(listingStatusPresentation("expiring_soon")).toEqual({ label: "Segera berakhir", badgeVariant: "warning" });
  });

  it("badges new as a success state", () => {
    expect(listingStatusPresentation("new")).toEqual({ label: "Baru", badgeVariant: "success" });
  });
});
