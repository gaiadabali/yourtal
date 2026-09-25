import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Toaster } from "./toaster";
import { dismissToast, toast } from "./use-toast";

function ToastLauncher() {
  return (
    <>
      <button
        type="button"
        onClick={() => toast({ title: "Reward earned", description: "50 pts" })}
      >
        Raise
      </button>
      <Toaster />
    </>
  );
}

describe("useToast / Toaster", () => {
  it("renders a toast raised via toast() inside a mounted Toaster", async () => {
    render(<ToastLauncher />);
    fireEvent.click(screen.getByRole("button", { name: "Raise" }));

    expect(await screen.findByText("Reward earned")).toBeInTheDocument();
    expect(screen.getByText("50 pts")).toBeInTheDocument();
  });

  it("removes the toast from the store when dismissed by id", async () => {
    render(<ToastLauncher />);
    let id = "";
    act(() => {
      id = toast({ title: "Direct dismiss" }).id;
    });
    expect(await screen.findByText("Direct dismiss")).toBeInTheDocument();

    act(() => dismissToast(id));
    expect(screen.queryByText("Direct dismiss")).not.toBeInTheDocument();
  });
});
