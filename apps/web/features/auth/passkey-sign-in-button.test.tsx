import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import enAU from "@/messages/en-AU/auth.json";
import { PasskeySignInButton } from "./passkey-sign-in-button";
import { passkeySignInAction, passkeySignInOptionsAction } from "./second-factor-actions";

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock("./second-factor-actions", () => ({
  passkeySignInOptionsAction: vi.fn(),
  passkeySignInAction: vi.fn(),
}));

function renderButton(returnTo?: string) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ auth: enAU }}>
      <PasskeySignInButton returnTo={returnTo} />
    </NextIntlClientProvider>,
  );
}

describe("PasskeySignInButton", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
    vi.mocked(passkeySignInOptionsAction).mockResolvedValue({
      ok: true,
      data: { challengeId: "chal-1", options: { challenge: "abc" } },
    });
  });

  it("is hidden when the browser cannot do WebAuthn", () => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    renderButton();

    expect(
      screen.queryByRole("button", { name: "Sign in with a passkey" }),
    ).not.toBeInTheDocument();
  });

  it("runs the browser prompt, then signs in with its answer and returnTo", async () => {
    const user = userEvent.setup();
    const assertion = { id: "cred-1" };
    vi.mocked(startAuthentication).mockResolvedValue(assertion as never);
    vi.mocked(passkeySignInAction).mockResolvedValue({ ok: false, code: "factor_invalid" });
    renderButton("/wallet");

    await user.click(screen.getByRole("button", { name: "Sign in with a passkey" }));

    await waitFor(() => {
      expect(passkeySignInAction).toHaveBeenCalledWith("chal-1", assertion, "/wallet");
    });
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "abc" } });
  });

  it("shows an inline message when the person closes the prompt", async () => {
    const user = userEvent.setup();
    const cancelled = Object.assign(new Error("closed"), {
      name: "WebAuthnError",
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: { name: "NotAllowedError" },
    });
    vi.mocked(startAuthentication).mockRejectedValue(cancelled);
    renderButton();

    await user.click(screen.getByRole("button", { name: "Sign in with a passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The passkey prompt was closed");
    expect(passkeySignInAction).not.toHaveBeenCalled();
  });

  it("shows the server's refusal inline", async () => {
    const user = userEvent.setup();
    vi.mocked(startAuthentication).mockResolvedValue({ id: "cred-1" } as never);
    vi.mocked(passkeySignInAction).mockResolvedValue({ ok: false, code: "factor_invalid" });
    renderButton();

    await user.click(screen.getByRole("button", { name: "Sign in with a passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That passkey didn't work");
  });

  it("shows a message when the options could not be fetched", async () => {
    const user = userEvent.setup();
    vi.mocked(passkeySignInOptionsAction).mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "down" },
    });
    renderButton();

    await user.click(screen.getByRole("button", { name: "Sign in with a passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be reached");
    expect(startAuthentication).not.toHaveBeenCalled();
  });
});
