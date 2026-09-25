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
});

describe("BrandWordmark", () => {
  it("shows the literal brand name as visible, accessible text", () => {
    render(<BrandWordmark />);
    expect(screen.getByText("YourTal")).toBeInTheDocument();
  });

  it("bakes in no aria-label by default: the visible text is the accessible name", () => {
    const { container } = render(<BrandWordmark />);
    expect(container.firstElementChild).not.toHaveAttribute("aria-label");
  });

  it("accepts an override accessible name when the caller needs one", () => {
    render(<BrandWordmark aria-label="YourTal home" />);
    expect(screen.getByLabelText("YourTal home")).toBeInTheDocument();
  });

  it('stays readable as just "YourTal" inside a link, since the mark is hidden', () => {
    render(
      <a href="/">
        <BrandWordmark />
      </a>,
    );
    expect(screen.getByRole("link", { name: "YourTal" })).toBeInTheDocument();
  });
});
