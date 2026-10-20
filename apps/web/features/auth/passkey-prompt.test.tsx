import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import enAU from "@/messages/en-AU/auth.json";
import { PasskeyPrompt } from "./passkey-prompt";
import {
  registerPasskeyAction,
  registerPasskeyOptionsAction,
} from "@/features/me/sign-in-methods-actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock("@/features/me/sign-in-methods-actions", () => ({
  registerPasskeyOptionsAction: vi.fn(),
  registerPasskeyAction: vi.fn(),
}));

function renderPrompt() {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ auth: enAU }}>
      <PasskeyPrompt returnTo="/wallet" />
    </NextIntlClientProvider>,
  );
}

describe("PasskeyPrompt", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
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
});
