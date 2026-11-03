import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "./stepper";

const steps = [
  { key: "details", label: "Details" },
  { key: "confirm", label: "Confirm" },
  { key: "done", label: "Done" },
];

describe("Stepper", () => {
  it("renders every step label", () => {
    render(<Stepper steps={steps} currentIndex={1} />);
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("marks only the current step with aria-current=step", () => {
    render(<Stepper steps={steps} currentIndex={1} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[2]).not.toHaveAttribute("aria-current");
  });

  it("shows a skipped step with a dash and says so, not with a checkmark", () => {
    const withSkip = [
      { key: "details", label: "Details" },
      { key: "extras", label: "Extras", skipped: true, skippedLabel: "skipped" },
      { key: "done", label: "Done" },
    ];
    const { container } = render(<Stepper steps={withSkip} currentIndex={2} />);
    // One check (Details), one dash (Extras).
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(container.querySelectorAll(".lucide-check")).toHaveLength(1);
    expect(screen.getByText("(skipped)")).toBeInTheDocument();
  });

  it("ignores skipped on a step that is not behind the current one", () => {
    const withSkip = [
      { key: "a", label: "A" },
      { key: "b", label: "B", skipped: true, skippedLabel: "skipped" },
    ];
    render(<Stepper steps={withSkip} currentIndex={0} />);
    expect(screen.queryByText("(skipped)")).not.toBeInTheDocument();
  });

  it("renders a checkmark for completed steps", () => {
    const { container } = render(<Stepper steps={steps} currentIndex={2} />);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });
});
