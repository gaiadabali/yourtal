import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./switch";

describe("Switch", () => {
  it("exposes the switch role, its accessible name and the checked state", () => {
    render(<Switch label="Auto-play videos" checked={false} onCheckedChange={() => {}} />);
    const control = screen.getByRole("switch", { name: "Auto-play videos" });
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  it("calls onCheckedChange with the toggled value when clicked", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Sound" checked={false} onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole("switch", { name: "Sound" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("toggles its own state when uncontrolled", async () => {
    render(<Switch label="Notifications" defaultChecked={false} />);
    const control = screen.getByRole("switch", { name: "Notifications" });
    await userEvent.click(control);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("has a 44px hit target", () => {
    render(<Switch label="Downloads" />);
    const control = screen.getByRole("switch", { name: "Downloads" });
    expect(control.className).toContain("h-11");
    expect(control.className).toContain("w-11");
  });

  it("does not toggle when disabled", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Locked" disabled checked={false} onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole("switch", { name: "Locked" }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
