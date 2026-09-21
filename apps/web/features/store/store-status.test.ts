import { describe, expect, it } from "vitest";
import { listingStatusPresentation } from "./store-status";

describe("listingStatusPresentation (id-ID)", () => {
  it("returns null for the unbadged available state", () => {
    expect(listingStatusPresentation("available", "id-ID")).toBeNull();
  });

  it("badges sold_out as a danger 'Habis' state", () => {
    expect(listingStatusPresentation("sold_out", "id-ID")).toEqual({
      label: "Habis",
      badgeVariant: "danger",
    });
  });

  it("badges expiring_soon as a warning state", () => {
    expect(listingStatusPresentation("expiring_soon", "id-ID")).toEqual({
      label: "Segera berakhir",
      badgeVariant: "warning",
    });
  });

  it("badges new as a success state", () => {
    expect(listingStatusPresentation("new", "id-ID")).toEqual({
      label: "Baru",
      badgeVariant: "success",
    });
  });
});

describe("listingStatusPresentation (en-AU, YT-0405)", () => {
  it("badges sold_out as a danger 'Sold out' state", () => {
    expect(listingStatusPresentation("sold_out", "en-AU")).toEqual({
      label: "Sold out",
      badgeVariant: "danger",
    });
  });

  it("badges expiring_soon as a warning state", () => {
    expect(listingStatusPresentation("expiring_soon", "en-AU")).toEqual({
      label: "Expiring soon",
      badgeVariant: "warning",
    });
  });

  it("badges new as a success state", () => {
    expect(listingStatusPresentation("new", "en-AU")).toEqual({
      label: "New",
      badgeVariant: "success",
    });
  });
});
