import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeSecuritySection } from "./me-security-section";

describe("MeSecuritySection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("never claims a phone number it does not have, and does not overclaim what OTP or passkeys prove", () => {
    render(<MeSecuritySection locale="en-AU" />);
    expect(screen.getByText(/does not verify who you are/)).toBeInTheDocument();
    expect(screen.getByText(/It's a convenience, not proof of identity/)).toBeInTheDocument();
    expect(screen.queryByText(/secure/i)).not.toBeInTheDocument();
  });

  it("starts not enrolled, and enrolling/removing is one click that visibly flips the badge and persists", async () => {
    const user = userEvent.setup();
    render(<MeSecuritySection locale="en-AU" />);
    expect(screen.getByText("Not set up")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Set up passkey (demo)" }));
    expect(screen.getByText("Enrolled on this device (demo)")).toBeInTheDocument();
    expect(window.localStorage.getItem("yourtal:me-passkey-demo")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Remove passkey (demo)" }));
    expect(screen.getByText("Not set up")).toBeInTheDocument();
    expect(window.localStorage.getItem("yourtal:me-passkey-demo")).toBe("false");
  });

  it("labels the passkey control as a prototype", () => {
    render(<MeSecuritySection locale="en-AU" />);
    expect(screen.getByText(/Prototype/)).toBeInTheDocument();
  });
});
