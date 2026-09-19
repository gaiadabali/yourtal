import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INTEREST_OPTIONS } from "./interest-option";
import { InterestPicker } from "./interest-picker";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("InterestPicker", () => {
  beforeEach(() => {
    push.mockClear();
    window.localStorage.clear();
  });

  it("renders every interest as an unselected, keyboard-operable toggle button", () => {
    render(<InterestPicker region="AU" returnTo={null} />);
    const buttons = screen.getAllByRole("button", { pressed: false });
    // +1 for the "Skip for now" action button, which is not a toggle and has no aria-pressed.
    expect(buttons).toHaveLength(INTEREST_OPTIONS.length);
  });

  it("labels the continue action honestly: Skip for now with zero selections, Continue once one is picked", async () => {
    const user = userEvent.setup();
    render(<InterestPicker region="AU" returnTo={null} />);

    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();

    const first = INTEREST_OPTIONS[0];
    if (first === undefined) {
      throw new Error("expected at least one interest option");
    }
    await user.click(screen.getByRole("button", { name: first.labelEn }));

    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("toggles selection back off on a second click", async () => {
    const user = userEvent.setup();
    render(<InterestPicker region="AU" returnTo={null} />);
    const first = INTEREST_OPTIONS[0];
    if (first === undefined) {
      throw new Error("expected at least one interest option");
    }
    const button = screen.getByRole("button", { name: first.labelEn });

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("saves the selection and advances to the done step for the chosen region", async () => {
    const user = userEvent.setup();
    render(<InterestPicker region="ID" returnTo={null} />);
    const first = INTEREST_OPTIONS[0];
    if (first === undefined) {
      throw new Error("expected at least one interest option");
    }

    await user.click(screen.getByRole("button", { name: first.labelId }));
    await user.click(screen.getByRole("button", { name: "Lanjutkan" }));

    expect(push).toHaveBeenCalledWith("/onboarding/ID/done");
    const saved: unknown = JSON.parse(
      window.localStorage.getItem("yourtal:onboarding-interests") ?? "[]",
    );
    expect(saved).toStrictEqual([first.id]);
  });

  it("never blocks continuing — zero selections is a valid, honest choice", () => {
    render(<InterestPicker region="AU" returnTo={null} />);
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeEnabled();
  });
});
