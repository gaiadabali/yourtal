import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeInterestsSection } from "./me-interests-section";

describe("MeInterestsSection", () => {
  it("renders every catalogue option as a pressable, keyboard-operable toggle", () => {
    render(<MeInterestsSection locale="en-AU" selectedIds={["travel"]} onToggle={vi.fn()} />);
    const travel = screen.getByRole("button", { name: "Travel" });
    expect(travel).toHaveAttribute("aria-pressed", "true");
    const food = screen.getByRole("button", { name: "Food & drink" });
    expect(food).toHaveAttribute("aria-pressed", "false");
  });

  it("selecting and deselecting are the same one-click gesture — both call onToggle with the id", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<MeInterestsSection locale="en-AU" selectedIds={["travel"]} onToggle={onToggle} />);

    await user.click(screen.getByRole("button", { name: "Travel" }));
    expect(onToggle).toHaveBeenCalledWith("travel");

    await user.click(screen.getByRole("button", { name: "Food & drink" }));
    expect(onToggle).toHaveBeenCalledWith("food");
  });

  it("shows the id-ID label set for id-ID", () => {
    render(<MeInterestsSection locale="id-ID" selectedIds={[]} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Traveling" })).toBeInTheDocument();
  });

  it("announces the selected count", () => {
    render(
      <MeInterestsSection locale="en-AU" selectedIds={["travel", "food"]} onToggle={vi.fn()} />,
    );
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
  });
});
