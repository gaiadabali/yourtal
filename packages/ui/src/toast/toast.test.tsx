import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./toast";

function ControlledToast({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = React.useState(true);
  return (
    <ToastProvider>
      <Toast
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
      >
        <ToastTitle>Reward earned</ToastTitle>
        <ToastDescription>You earned 50 points.</ToastDescription>
        <ToastAction altText="Undo the redemption">Undo</ToastAction>
        <ToastClose />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}

describe("Toast", () => {
  it("is announced as a status region with title, description and action", () => {
    render(<ControlledToast />);
    const toast = screen.getByRole("status");
    expect(toast).toBeInTheDocument();
    expect(screen.getByText("Reward earned")).toBeInTheDocument();
    expect(screen.getByText("You earned 50 points.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("dismisses when the close control is activated", async () => {
    const onOpenChange = vi.fn();
    render(<ControlledToast onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("dismisses on Escape", async () => {
    const onOpenChange = vi.fn();
    render(<ControlledToast onOpenChange={onOpenChange} />);

    fireEvent.keyDown(screen.getByRole("status"), { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
