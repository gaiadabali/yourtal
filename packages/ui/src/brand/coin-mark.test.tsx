import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CoinMark } from "./coin-mark";

describe("CoinMark", () => {
  it("is decorative: hidden from the accessibility tree", () => {
    const { container } = render(<CoinMark />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("sizes both dimensions equally", () => {
    const { container } = render(<CoinMark size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
  });

  it("draws in currentColor, so a caller's text colour recolours it", () => {
    const { container } = render(<CoinMark />);
    const svg = container.querySelector("svg");
    expect(svg?.querySelector("circle")).toHaveAttribute("stroke", "currentColor");
    expect(svg?.querySelector("path")).toHaveAttribute("stroke", "currentColor");
  });
});
