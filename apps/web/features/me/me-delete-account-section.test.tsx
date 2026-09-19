import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeDeleteAccountSection } from "./me-delete-account-section";
import { writeConsentPreferences } from "./me-consent-store";
import { withPurposeChanged, defaultConsentPreferences } from "./me-consent";
import { writeInterestIds } from "./me-interests-store";

describe("MeDeleteAccountSection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("states the points-forfeiture and voucher facts before any irreversible action, and gates confirm on the checkbox", async () => {
    const user = userEvent.setup();
    render(<MeDeleteAccountSection locale="en-AU" />);

    await user.click(screen.getByRole("button", { name: "Delete my account" }));

    expect(screen.getByText(/Unspent points are forfeited/)).toBeInTheDocument();
    expect(screen.getByText(/on hold or about to expire/)).toBeInTheDocument();
    expect(screen.getByText(/no cash refund/)).toBeInTheDocument();
    expect(screen.getByText(/keep their code and can still be redeemed/)).toBeInTheDocument();
    expect(screen.getByText(/log back in to view them/)).toBeInTheDocument();
    expect(screen.getByText("This can't be undone.")).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", { name: "Delete my account" });
    expect(confirmButton).toBeDisabled();

    await user.click(
      screen.getByRole("checkbox", {
        name: "I understand my unspent points will be forfeited and this can't be undone.",
      }),
    );
    expect(confirmButton).toBeEnabled();
  });

  it("cancel returns to idle without clearing anything", async () => {
    const user = userEvent.setup();
    writeInterestIds(["travel"]);
    render(<MeDeleteAccountSection locale="en-AU" />);
    await user.click(screen.getByRole("button", { name: "Delete my account" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeInTheDocument();
    expect(window.localStorage.getItem("yourtal:onboarding-interests")).not.toBeNull();
  });

  it("confirming clears this device's local consent, interests and security records and reports honestly, not a fake success", async () => {
    const user = userEvent.setup();
    writeConsentPreferences(
      withPurposeChanged(
        defaultConsentPreferences("2026-01-01T00:00:00.000Z"),
        "marketing",
        true,
        "2026-01-01T00:00:00.000Z",
      ),
    );
    writeInterestIds(["travel"]);

    render(<MeDeleteAccountSection locale="en-AU" />);
    await user.click(screen.getByRole("button", { name: "Delete my account" }));
    await user.click(
      screen.getByRole("checkbox", {
        name: "I understand my unspent points will be forfeited and this can't be undone.",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Delete my account" }));

    expect(screen.getByText("Local settings cleared")).toBeInTheDocument();
    expect(screen.getByText(/no live account-deletion endpoint yet/)).toBeInTheDocument();
    expect(window.localStorage.getItem("yourtal:me-consent")).toBeNull();
    expect(window.localStorage.getItem("yourtal:onboarding-interests")).toBeNull();
  });
});
