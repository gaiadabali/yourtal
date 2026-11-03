import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/auth.json";
import { LoginCodeForm } from "./login-code-form";

// A `"use server"` export backed by `next/headers`; only the form's rendering is tested here.
vi.mock("./second-factor-actions", () => ({ totpSignInAction: vi.fn() }));

function renderForm(props: React.ComponentProps<typeof LoginCodeForm> = {}) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ auth: enAU }}>
      <LoginCodeForm {...props} />
    </NextIntlClientProvider>,
  );
}

describe("LoginCodeForm", () => {
  it("asks for one numeric one-time code", () => {
    renderForm();
    const input = screen.getByLabelText("6-digit code");

    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("name", "code");
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("carries returnTo in a hidden field only when there is one", () => {
    const { container, unmount } = renderForm({ returnTo: "/wallet" });
    expect(container.querySelector('input[name="returnTo"]')).toHaveValue("/wallet");
    unmount();

    const again = renderForm();
    expect(again.container.querySelector('input[name="returnTo"]')).toBeNull();
  });

  it("shows plain copy for a wrong code and for too many attempts", () => {
    const { unmount } = renderForm({ errorCode: "factor_invalid" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That code didn't work. Check your app and try again.",
    );
    unmount();

    renderForm({ errorCode: "throttled" });
    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts");
  });

  it("falls back to the generic message for a code it does not name", () => {
    renderForm({ errorCode: "something_new" });
    expect(screen.getByRole("alert")).toHaveTextContent("Something wasn't quite right");
  });
});
