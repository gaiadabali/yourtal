import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

function renderDialog() {
  return render(
    <Dialog>
      <DialogTrigger>Open settings</DialogTrigger>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Manage your account.</DialogDescription>
        <button type="button">First field</button>
        <DialogClose>Cancel</DialogClose>
      </DialogContent>
    </Dialog>,
  );
}

describe("Dialog", () => {
  it("is closed until the trigger is activated, then exposes an accessible dialog", async () => {
    renderDialog();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Manage your account.")).toBeInTheDocument();
  });

  it("moves focus inside the dialog on open (focus trap)", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    renderDialog();
    const trigger = screen.getByRole("button", { name: "Open settings" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes when the close control is activated", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    await screen.findByRole("dialog", { name: "Settings" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
