import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Mascot } from "./mascot";

describe("Mascot", () => {
  it("is hidden from assistive technology when it has no label", () => {
    const { container } = render(<Mascot />);
    expect(container.querySelector("img")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is an image with the caller's own (translated) name when labelled", () => {
    render(<Mascot label="Maskot YourTal" />);
    expect(screen.getByRole("img", { name: "Maskot YourTal" })).toBeInTheDocument();
  });

  it("draws the official line art, unaltered, on the Charcoal plate", () => {
    const { container } = render(<Mascot />);
    expect(container.firstElementChild).toHaveClass("bg-brand-ground");
    // The art is one static yellow file: nothing is filled, outlined or recoloured here.
    expect(container.querySelector("img")).toHaveAttribute("src", "/brand/yourtal-mascot.svg");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("keeps the artwork's own proportions", () => {
    const { container } = render(<Mascot size="lg" />);
    const svg = container.querySelector("img");
    const ratio = Number(svg?.getAttribute("width")) / Number(svg?.getAttribute("height"));
    expect(ratio).toBeCloseTo(1641 / 1247, 1);
  });
});
