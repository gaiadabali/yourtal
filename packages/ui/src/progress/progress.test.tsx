import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Progress } from "./progress";

describe("Progress", () => {
  it("exposes the progressbar role with the required accessible name and current value", () => {
    render(<Progress value={40} aria-label="Watch progress" />);
    const bar = screen.getByRole("progressbar", { name: "Watch progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("respects a custom max when computing the reported value", () => {
    render(<Progress value={5} max={10} aria-label="Chapters watched" />);
    const bar = screen.getByRole("progressbar", { name: "Chapters watched" });
    expect(bar).toHaveAttribute("aria-valuemax", "10");
    expect(bar).toHaveAttribute("aria-valuenow", "5");
  });
});
