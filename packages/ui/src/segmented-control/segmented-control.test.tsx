import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./segmented-control";

const OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

describe("SegmentedControl", () => {
  it("exposes radiogroup semantics with the required label and marks the current value checked", () => {
    render(
      <SegmentedControl label="Time range" options={OPTIONS} value="week" onChange={() => {}} />,
    );
    expect(screen.getByRole("radiogroup", { name: "Time range" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Week" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Day" })).toHaveAttribute("aria-checked", "false");
  });

  it("only tab-stops on the selected option (roving tabindex)", () => {
    render(
      <SegmentedControl label="Time range" options={OPTIONS} value="week" onChange={() => {}} />,
    );
    expect(screen.getByRole("radio", { name: "Week" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Day" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "Month" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves selection with the arrow keys, wrapping at the ends", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl label="Time range" options={OPTIONS} value="month" onChange={onChange} />,
    );
    screen.getByRole("radio", { name: "Month" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("day");
  });

  it("selects an option on click", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl label="Time range" options={OPTIONS} value="day" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Month" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });
});
