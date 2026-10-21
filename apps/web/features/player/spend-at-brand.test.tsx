import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeListingFixture } from "@/features/burn/burn-test-fixtures";
import { SpendAtBrand } from "./spend-at-brand";

describe("SpendAtBrand", () => {
  const listing = makeListingFixture({ currency: "AUD", faceValueMinor: 5_000 });

  it("writes the face value in the viewer's language, in the listing's own currency", () => {
    render(<SpendAtBrand merchantName="Harbour" listings={[listing]} locale="id-ID" />);
    expect(screen.getByText("AU$50,00")).toBeInTheDocument();
  });

  it("writes dollars with a dollar sign for an English viewer", () => {
    render(<SpendAtBrand merchantName="Harbour" listings={[listing]} locale="en-AU" />);
    expect(screen.getByText("$50.00")).toBeInTheDocument();
  });
});
