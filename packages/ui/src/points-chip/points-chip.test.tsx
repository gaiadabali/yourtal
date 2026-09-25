import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PointsChip } from "./points-chip";

describe("PointsChip", () => {
  it("formats the value with tabular numerals and takes the caller's accessible name", () => {
    render(<PointsChip value={1240} aria-label="1,240 points available" />);
    const chip = screen.getByLabelText("1,240 points available");
    expect(chip).toHaveTextContent("1,240");
  });

  it("derives the accessible name from the formatted value via formatLabel", () => {
    render(
      <PointsChip
        value={50}
        prefix="+"
        formatLabel={(formatted) => `Earned ${formatted} points`}
      />,
    );
    expect(screen.getByLabelText("Earned 50 points")).toHaveTextContent("+50");
  });

  it("formats using the given locale", () => {
    render(<PointsChip value={12345} locale="id-ID" aria-label="12.345 poin" />);
    expect(screen.getByLabelText("12.345 poin")).toHaveTextContent("12.345");
  });

  it("hides the coin glyph from the accessibility tree", () => {
    const { container } = render(<PointsChip value={5} aria-label="5 points" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
