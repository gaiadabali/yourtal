import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublicFooter } from "./public-footer";
import { PublicInfoLinks } from "./public-info-links";

describe("PublicFooter", () => {
  it("links to both regions", () => {
    render(<PublicFooter locale="en-AU" />);
    expect(screen.getByRole("link", { name: "Australia (English)" })).toHaveAttribute(
      "href",
      "/au",
    );
    expect(screen.getByRole("link", { name: "Indonesia (Bahasa Indonesia)" })).toHaveAttribute(
      "href",
      "/id",
    );
  });

  it("localises the tagline and region labels for id-ID", () => {
    render(<PublicFooter locale="id-ID" />);
    expect(
      screen.getByText("Tonton, pelajari, dapatkan poin — dan belanjakan di tempat kamu tinggal."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Indonesia (Bahasa Indonesia)" })).toBeInTheDocument();
  });

  it("renders the info links under the region's prefix", () => {
    render(
      <PublicFooter locale="en-AU">
        <PublicInfoLinks locale="en-AU" basePath="/au" />
      </PublicFooter>,
    );
    expect(screen.getByRole("link", { name: "How points work" })).toHaveAttribute(
      "href",
      "/au/how-points-work",
    );
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/au/privacy");
  });
});
