import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startRegistration,
} from "@simplewebauthn/browser";
import enAU from "@/messages/en-AU/auth.json";
import idID from "@/messages/id-ID/auth.json";
import { PasskeyPrompt } from "./passkey-prompt";
import {
  registerPasskeyAction,
  registerPasskeyOptionsAction,
} from "@/features/me/sign-in-methods-actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(),
  platformAuthenticatorIsAvailable: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock("@/features/me/sign-in-methods-actions", () => ({
  registerPasskeyOptionsAction: vi.fn(),
  registerPasskeyAction: vi.fn(),
}));

function renderPrompt(reason?: "earn", locale: "en-AU" | "id-ID" = "en-AU") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ auth: locale === "en-AU" ? enAU : idID }}>
      <PasskeyPrompt returnTo="/wallet" reason={reason} />
    </NextIntlClientProvider>,
  );
}

describe("PasskeyPrompt", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
    vi.mocked(platformAuthenticatorIsAvailable).mockResolvedValue(true);
  });

  it("Not now continues to returnTo without touching the browser prompt", async () => {
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(push).toHaveBeenCalledWith("/wallet");
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it("Add runs the registration ceremony, then continues to returnTo", async () => {
    const user = userEvent.setup();
    vi.mocked(registerPasskeyOptionsAction).mockResolvedValue({
      ok: true,
      data: { options: { challenge: "abc" } },
    });
    vi.mocked(startRegistration).mockResolvedValue({ id: "cred-1" } as never);
    vi.mocked(registerPasskeyAction).mockResolvedValue({
      ok: true,
      data: {
        id: "p1",
        name: "Passkey",
        createdAt: "2026-10-21T01:00:00.000Z",
        lastUsedAt: null,
        synced: false,
      },
    });
    renderPrompt();

    await user.click(screen.getByRole("button", { name: "Add a passkey" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/wallet"));
    expect(registerPasskeyAction).toHaveBeenCalledWith({ id: "cred-1" });
  });

  it("stays put with a message when the prompt is cancelled", async () => {
    const user = userEvent.setup();
    vi.mocked(registerPasskeyOptionsAction).mockResolvedValue({
      ok: true,
      data: { options: { challenge: "abc" } },
    });
    vi.mocked(startRegistration).mockRejectedValue(
      Object.assign(new Error("x"), { name: "NotAllowedError" }),
    );
    renderPrompt();

    await user.click(screen.getByRole("button", { name: "Add a passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The passkey prompt was closed");
    expect(push).not.toHaveBeenCalled();
  });

  it("offers only a way on when the browser has no WebAuthn", async () => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    const user = userEvent.setup();
    renderPrompt();

    expect(screen.queryByRole("button", { name: "Add a passkey" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(push).toHaveBeenCalledWith("/wallet");
  });

  describe("reason=earn", () => {
    it("registers, then returns to returnTo so the player can earn", async () => {
      const user = userEvent.setup();
      vi.mocked(registerPasskeyOptionsAction).mockResolvedValue({
        ok: true,
        data: { options: { challenge: "abc" } },
      });
      vi.mocked(startRegistration).mockResolvedValue({ id: "cred-1" } as never);
      vi.mocked(registerPasskeyAction).mockResolvedValue({
        ok: true,
        data: {
          id: "p1",
          name: "Passkey",
          createdAt: "2026-10-21T01:00:00.000Z",
          lastUsedAt: null,
          synced: false,
        },
      });
      renderPrompt("earn");

      expect(screen.queryByRole("button", { name: "Not now" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Add a passkey" }));

      await waitFor(() => expect(push).toHaveBeenCalledWith("/wallet"));
    });

    it("keeps the button and explains the phone route when the device has no built-in passkey", async () => {
      vi.mocked(platformAuthenticatorIsAvailable).mockResolvedValue(false);
      renderPrompt("earn");

      expect(await screen.findByText(/choose a phone or tablet you own/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add a passkey" })).toBeEnabled();
    });

    it("says so, and links back instead of a dead Continue, when the browser has no WebAuthn", () => {
      vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
      renderPrompt("earn");

      expect(screen.getByRole("status")).toHaveTextContent(
        "This browser can't create passkeys, so you can't earn points from it yet",
      );
      expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/wallet");
    });

    it("has the same unsupported-browser copy in Indonesian", () => {
      vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
      renderPrompt("earn", "id-ID");

      expect(screen.getByRole("status")).toHaveTextContent(
        "Browser ini tidak bisa membuat passkey",
      );
      expect(screen.getByRole("link", { name: "Kembali" })).toHaveAttribute("href", "/wallet");
    });
  });
});
