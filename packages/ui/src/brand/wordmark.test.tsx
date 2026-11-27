import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandMark, BrandWordmark } from "./wordmark";

describe("BrandMark", () => {
  it("is decorative on its own — the caller supplies the accessible name", () => {
    const { container } = render(<BrandMark />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("sits on the Charcoal plate unless the caller says the surface already is Charcoal", () => {
    const { container, rerender } = render(<BrandMark />);
    expect(container.firstElementChild).toHaveClass("bg-brand-ground");
    rerender(<BrandMark ground={false} />);
    expect(container.firstElementChild).not.toHaveClass("bg-brand-ground");
  });

  it("keeps the artwork's own proportions", () => {
    const { container } = render(<BrandMark size="lg" />);
    const svg = container.querySelector("svg");
    const ratio = Number(svg?.getAttribute("width")) / Number(svg?.getAttribute("height"));
    expect(ratio).toBeCloseTo(736 / 446, 1);
  });
});

describe("BrandWordmark", () => {
  it("is one image named with the brand name", () => {
    render(<BrandWordmark />);
    expect(screen.getByRole("img", { name: "YourTal" })).toBeInTheDocument();
  });

  it("draws in the brand yellow on the Charcoal plate, never in a caller's colour", () => {
    const { container } = render(<BrandWordmark />);
    expect(container.firstElementChild).toHaveClass("bg-brand-ground");
    expect(container.querySelector("svg")).toHaveClass("text-brand-logo");
  });

  it("keeps the artwork's own proportions", () => {
    const { container } = render(<BrandWordmark size="sm" />);
    const svg = container.querySelector("svg");
    const ratio = Number(svg?.getAttribute("width")) / Number(svg?.getAttribute("height"));
    expect(ratio).toBeCloseTo(2940 / 468, 1);
  });

  it("is at least the guide's 120 px wide at its smallest size", () => {
    const { container } = render(<BrandWordmark size="sm" />);
    expect(Number(container.querySelector("svg")?.getAttribute("width"))).toBeGreaterThanOrEqual(
      120,
    );
  });

  it("accepts an override accessible name when the caller needs one", () => {
    render(<BrandWordmark aria-label="YourTal home" />);
    expect(screen.getByRole("img", { name: "YourTal home" })).toBeInTheDocument();
  });

  it('stays readable as just "YourTal" inside a link', () => {
    render(
      <a href="/">
        <BrandWordmark />
      </a>,
    );
    expect(screen.getByRole("link", { name: "YourTal" })).toBeInTheDocument();
  });
});
