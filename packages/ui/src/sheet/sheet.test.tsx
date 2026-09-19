import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";

function renderSheet() {
  return render(
    <Sheet>
      <SheetTrigger>Open filters</SheetTrigger>
      <SheetContent side="right">
        <SheetTitle>Filters</SheetTitle>
        <SheetDescription>Narrow the results.</SheetDescription>
        <button type="button">Apply</button>
      </SheetContent>
    </Sheet>,
  );
}

describe("Sheet", () => {
  it("opens as an accessible dialog when the trigger is activated", async () => {
    renderSheet();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open filters" }));

    const sheet = await screen.findByRole("dialog", { name: "Filters" });
    expect(sheet).toBeInTheDocument();
    expect(screen.getByText("Narrow the results.")).toBeInTheDocument();
  });

  it("traps focus inside the panel while open", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Open filters" }));
    const sheet = await screen.findByRole("dialog", { name: "Filters" });

    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    renderSheet();
    const trigger = screen.getByRole("button", { name: "Open filters" });
    fireEvent.click(trigger);
    const sheet = await screen.findByRole("dialog", { name: "Filters" });

    fireEvent.keyDown(sheet, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
