import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotEarningMoment } from "./earn-moment";

describe("the not-earning moment and the identity check (5.9.f)", () => {
  it("does not ask a verified person on a disposable address to verify their email", () => {
    render(
      <NotEarningMoment
        reason="identity_check_required"
        identityCheck={["use_permanent_email"]}
        locale="en-AU"
      />,
    );
    expect(
      screen.getByText("This email address can't be used to earn points."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send me the verification email" }),
    ).not.toBeInTheDocument();
  });

  it("asks to verify when that is what is missing, or when the server did not say", () => {
    const { unmount } = render(
      <NotEarningMoment
        reason="identity_check_required"
        identityCheck={["verify_email"]}
        locale="en-AU"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Send me the verification email" }),
    ).toBeInTheDocument();
    unmount();
    render(<NotEarningMoment reason="identity_check_required" locale="en-AU" />);
    expect(
      screen.getByRole("button", { name: "Send me the verification email" }),
    ).toBeInTheDocument();
  });
});
