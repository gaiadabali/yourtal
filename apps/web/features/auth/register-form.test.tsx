import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/auth.json";
import { RegisterForm } from "./register-form";

// `registerAction` is a `"use server"` export backed by `next/headers` and
// `server-only` — real in production, but not importable under vitest's
// plain Node environment (no RSC bundler condition). Mocked the same way
// `me-autoplay-section.test.tsx` mocks `me-actions.ts`; this file only
// tests the form's own rendering, never a real submission.
vi.mock("./auth-actions", () => ({ registerAction: vi.fn() }));

function renderForm(props: Partial<React.ComponentProps<typeof RegisterForm>> = {}) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ auth: enAU }}>
      <RegisterForm
        returnTo={null}
        defaultRegion="AU"
        defaultLocale="en-AU"
        teenModeEnabled={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

/** `years` ago, minus a day, so "today" never lands exactly on the boundary this year. */
function isoDateYearsAgo(years: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() - 1),
  );
  return d.toISOString().slice(0, 10);
}

describe("RegisterForm — the neutral age gate (6.2.a, 12.4.d/#5)", () => {
  it("shows no computed age and no guardian field, no matter what date of birth is typed", () => {
    renderForm();
    const dob = screen.getByLabelText("Date of birth");

    fireEvent.change(dob, { target: { value: isoDateYearsAgo(15) } });
    expect(screen.queryByLabelText(/parent or guardian/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.change(dob, { target: { value: isoDateYearsAgo(10) } });
    expect(screen.queryByLabelText(/parent or guardian/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.change(dob, { target: { value: isoDateYearsAgo(30) } });
    expect(screen.queryByLabelText(/parent or guardian/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("the submit button is never disabled by anything typed client-side", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Date of birth"), {
      target: { value: isoDateYearsAgo(10) },
    });
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("guardian_email_required: reveals the guardian-email field, an info notice, and a Continue button — the form stays open", () => {
    renderForm({ errorCode: "guardian_email_required" });

    expect(
      screen.getByText("A parent or guardian's email is required for your age."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByLabelText(/parent or guardian/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("too_young: a final refusal screen with no form at all — the date of birth cannot be edited and resubmitted", () => {
    renderForm({ errorCode: "too_young" });

    expect(screen.getByText("You can't create an account yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Date of birth")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start over" })).toHaveAttribute("href", "/register");
  });

  it("below_minimum_age: the same final refusal screen (teen registration closed)", () => {
    renderForm({ errorCode: "below_minimum_age" });

    expect(
      screen.getByText("You don't meet the minimum age to create an account."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Date of birth")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start over" })).toBeInTheDocument();
  });

  it("an unrelated errorCode renders that code's plain-language message and leaves the form open", () => {
    renderForm({ errorCode: "email_already_registered" });
    expect(screen.getByText("An account with this email already exists.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText(/parent or guardian/i)).not.toBeInTheDocument();
  });

  it("an unrecognised errorCode falls back to the generic message", () => {
    renderForm({ errorCode: "some_future_code" });
    expect(
      screen.getByText("Something wasn't quite right. Check your details and try again."),
    ).toBeInTheDocument();
  });
});
