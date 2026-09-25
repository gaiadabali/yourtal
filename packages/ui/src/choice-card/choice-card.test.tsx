import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChoiceCard } from "./choice-card";

describe("ChoiceCard", () => {
  it("exposes radio semantics with the title as the accessible name", () => {
    render(
      <ChoiceCard
        type="radio"
        name="plan"
        title="Weekly"
        description="Every Monday"
        onChange={() => {}}
      />,
    );
    const radio = screen.getByRole("radio", { name: "Weekly" });
    expect(radio).toHaveAccessibleDescription("Every Monday");
  });

  it("groups radios by name so only one can be checked", async () => {
    const onChange = vi.fn();
    render(
      <>
        <ChoiceCard type="radio" name="plan" title="Weekly" onChange={onChange} />
        <ChoiceCard type="radio" name="plan" title="Monthly" onChange={onChange} />
      </>,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    expect(screen.getByRole("radio", { name: "Weekly" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Monthly" }));
    expect(screen.getByRole("radio", { name: "Weekly" })).not.toBeChecked();
  });

  it("supports checkbox semantics", async () => {
    render(<ChoiceCard type="checkbox" title="Notify me" onChange={() => {}} />);
    const checkbox = screen.getByRole("checkbox", { name: "Notify me" });
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("renders the visible input as visually hidden, not removed from the tree", () => {
    render(<ChoiceCard type="radio" name="plan" title="Weekly" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Weekly" })).toHaveClass("sr-only");
  });
});
