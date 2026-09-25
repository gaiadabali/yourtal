import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chip } from "./chip";

describe("Chip", () => {
  it("exposes aria-pressed for a filter chip and toggles it on click", async () => {
    const onPressedChange = vi.fn();
    render(
      <Chip pressed={false} onPressedChange={onPressedChange}>
        Snacks
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "Snacks" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it("renders a static chip with no button semantics", () => {
    render(<Chip variant="static">Region: AU</Chip>);
    expect(screen.getByText("Region: AU").tagName).toBe("SPAN");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables the filter chip and blocks the toggle", async () => {
    const onPressedChange = vi.fn();
    render(
      <Chip pressed={false} onPressedChange={onPressedChange} disabled>
        Sold out
      </Chip>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Sold out" }));
    expect(onPressedChange).not.toHaveBeenCalled();
  });
});
