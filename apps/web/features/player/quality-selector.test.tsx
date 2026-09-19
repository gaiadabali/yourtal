import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QualitySelector } from "./quality-selector";

// Radix pointer-capture/ResizeObserver polyfills for jsdom live in
// apps/web/vitest.setup.ts (global setupFiles entry).

describe("QualitySelector", () => {
  it("defaults into the 360-480p band and shows that tier's own computed MB estimate on the trigger", () => {
    render(<QualitySelector durationSeconds={900} selectedTierId="480p" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /480p/ })).toHaveTextContent(/MB/);
  });

  it("opens a radiogroup listing every tier with its OWN distinct, computed MB estimate", async () => {
    render(<QualitySelector durationSeconds={900} selectedTierId="480p" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /480p/ }));

    const group = await screen.findByRole("radiogroup", { name: "Video quality" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);

    const labels = within(group).getAllByText(/MB for this video/);
    const values = labels.map((label) => label.textContent);
    expect(new Set(values).size).toBe(3); // no two options share the same hardcoded/generic number

    expect(within(group).getByRole("radio", { name: /480p/ })).toBeChecked();
  });

  it("calls onSelect with the chosen tier id when a different option is picked", async () => {
    const onSelect = vi.fn();
    render(<QualitySelector durationSeconds={900} selectedTierId="480p" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /480p/ }));

    const group = await screen.findByRole("radiogroup", { name: "Video quality" });
    fireEvent.click(within(group).getByRole("radio", { name: /720p/ }));

    expect(onSelect).toHaveBeenCalledWith("720p");
  });
});
