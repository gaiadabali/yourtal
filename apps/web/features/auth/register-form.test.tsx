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
// tests the form's own field-reveal logic, never a real submission.
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
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() - 1));
  return d.toISOString().slice(0, 10);
}

function fillDateOfBirth(iso: string) {
  fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: iso } });
}

describe("RegisterForm — the age gate (6.2.a, F4)", () => {
  it("an adult date of birth shows no notice and no guardian field; submit stays enabled", () => {
    renderForm();
    fillDateOfBirth(isoDateYearsAgo(30));

    expect(screen.queryByLabelText(/parent or guardian/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("a 15-year-old with teen registration OFF (this dev environment's default) is blocked, with no guardian field", () => {
    renderForm({ teenModeEnabled: false });
    fillDateOfBirth(isoDateYearsAgo(15));

    expect(screen.queryByLabelText(/parent or guardian/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("You don't meet the minimum age to create an account."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  });

  it("a 15-year-old with teen registration ON reveals the guardian-email field and stays enabled", () => {
    renderForm({ teenModeEnabled: true });
    fillDateOfBirth(isoDateYearsAgo(15));

    expect(screen.getByLabelText(/parent or guardian/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  it("an under-13 date of birth is blocked regardless of the teen flag, with no guardian field", () => {
    renderForm({ teenModeEnabled: true });
    fillDateOfBirth(isoDateYearsAgo(10));

    expect(screen.queryByLabelText(/parent or guardian/i)).not.toBeInTheDocument();
    expect(screen.getByText("You can't create an account yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  });

  it("an errorCode prop renders that code's plain-language message", () => {
    renderForm({ errorCode: "email_already_registered" });
    expect(
      screen.getByText("An account with this email already exists."),
    ).toBeInTheDocument();
  });

  it("an unrecognised errorCode falls back to the generic message", () => {
    renderForm({ errorCode: "some_future_code" });
    expect(
      screen.getByText("Something wasn't quite right. Check your details and try again."),
    ).toBeInTheDocument();
  });
});
