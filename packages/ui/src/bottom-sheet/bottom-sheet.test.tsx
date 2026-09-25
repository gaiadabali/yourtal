import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetTitle,
  BottomSheetTrigger,
} from "./bottom-sheet";

function renderBottomSheet() {
  return render(
    <BottomSheet>
      <BottomSheetTrigger>Open options</BottomSheetTrigger>
      <BottomSheetContent closeLabel="Close options">
        <BottomSheetTitle>Options</BottomSheetTitle>
        <BottomSheetDescription>Choose one.</BottomSheetDescription>
        <button type="button">First option</button>
      </BottomSheetContent>
    </BottomSheet>,
  );
}

describe("BottomSheet", () => {
  it("opens as an accessible dialog anchored with the given close label", async () => {
    renderBottomSheet();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open options" }));

    const sheet = await screen.findByRole("dialog", { name: "Options" });
    expect(sheet).toBeInTheDocument();
    expect(screen.getByText("Choose one.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close options" })).toBeInTheDocument();
  });

  it("traps focus inside the sheet while open", async () => {
    renderBottomSheet();
    fireEvent.click(screen.getByRole("button", { name: "Open options" }));
    const sheet = await screen.findByRole("dialog", { name: "Options" });

    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    renderBottomSheet();
    const trigger = screen.getByRole("button", { name: "Open options" });
    fireEvent.click(trigger);
    const sheet = await screen.findByRole("dialog", { name: "Options" });

    fireEvent.keyDown(sheet, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
