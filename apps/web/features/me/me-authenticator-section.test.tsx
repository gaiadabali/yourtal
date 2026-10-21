import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import enAU from "@/messages/en-AU/me.json";
import { MeAuthenticatorSection } from "./me-authenticator-section";
import {
  confirmTotpAction,
  disableTotpWithCodeAction,
  disableTotpWithPasskeyAction,
  passkeyStepUpOptionsAction,
  startTotpEnrolmentAction,
  stepUpAction,
} from "./sign-in-methods-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
// The real one loads `qrcode` through `next/dynamic`; only what it is handed matters here.
vi.mock("@/features/wallet/voucher-qr-code", () => ({
  VoucherQrCode: (props: { payload: string; code: string; label: string }) => (
    <div role="img" aria-label={props.label} data-payload={props.payload}>
      {props.code}
    </div>
  ),
}));
vi.mock("./sign-in-methods-actions", () => ({
  startTotpEnrolmentAction: vi.fn(),
  confirmTotpAction: vi.fn(),
  disableTotpWithCodeAction: vi.fn(),
  disableTotpWithPasskeyAction: vi.fn(),
  passkeyStepUpOptionsAction: vi.fn(),
  stepUpAction: vi.fn(),
  signInAgainAction: vi.fn(),
}));

const ENROLMENT = {
  otpauthUri: "otpauth://totp/YourTal:ada?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
};

function renderSection(props: React.ComponentProps<typeof MeAuthenticatorSection>) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ me: enAU }}>
      <MeAuthenticatorSection {...props} />
    </NextIntlClientProvider>,
  );
}

describe("MeAuthenticatorSection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
  });

  it("when off, sets up with a QR and a typeable key, and turns on once a code is confirmed", async () => {
    const user = userEvent.setup();
    vi.mocked(startTotpEnrolmentAction).mockResolvedValue({ ok: true, data: ENROLMENT });
    vi.mocked(confirmTotpAction).mockResolvedValue({ ok: true, data: { enabled: true } });
    renderSection({ enabled: false, available: true, hasPasskeys: false });

    expect(screen.getByText("Off")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up" }));

    const qr = await screen.findByRole("img", { name: /QR code to add YourTal/ });
    expect(qr).toHaveAttribute("data-payload", ENROLMENT.otpauthUri);
    expect(qr).toHaveTextContent("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");

    const turnOn = screen.getByRole("button", { name: "Turn on" });
    expect(turnOn).toBeDisabled();
    await user.type(screen.getByLabelText("6-digit code from your app"), "123 456");
    await user.click(turnOn);

    expect(confirmTotpAction).toHaveBeenCalledWith("123456");
    expect(await screen.findByText(/Authenticator app is on\./)).toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    // The seed is gone from the page once it is on.
    expect(screen.queryByRole("img", { name: /QR code/ })).not.toBeInTheDocument();
  });

  it("keeps the setup open with a message when the code is wrong", async () => {
    const user = userEvent.setup();
    vi.mocked(startTotpEnrolmentAction).mockResolvedValue({ ok: true, data: ENROLMENT });
    vi.mocked(confirmTotpAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 401, code: "factor_invalid", message: "bad" },
    });
    renderSection({ enabled: false, available: true, hasPasskeys: false });

    await user.click(screen.getByRole("button", { name: "Set up" }));
    await screen.findByRole("img", { name: /QR code/ });
    await user.type(screen.getByLabelText("6-digit code from your app"), "000000");
    await user.click(screen.getByRole("button", { name: "Turn on" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code didn't work. Check your app and try again.",
    );
    expect(screen.getByRole("img", { name: /QR code/ })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says it is already on when another tab finished setup first", async () => {
    const user = userEvent.setup();
    vi.mocked(startTotpEnrolmentAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 409, code: "totp_already_enabled", message: "on" },
    });
    renderSection({ enabled: false, available: true, hasPasskeys: false });

    await user.click(screen.getByRole("button", { name: "Set up" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already on");
    expect(refresh).toHaveBeenCalled();
  });

  it("sends the person to sign in again when setup needs a recent sign-in", async () => {
    const user = userEvent.setup();
    vi.mocked(startTotpEnrolmentAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 403, code: "reauthentication_required", message: "old" },
    });
    renderSection({ enabled: false, available: true, hasPasskeys: false });

    await user.click(screen.getByRole("button", { name: "Set up" }));

    expect(await screen.findByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });

  it("when on, turns off with a current code", async () => {
    const user = userEvent.setup();
    vi.mocked(disableTotpWithCodeAction).mockResolvedValue({ ok: true, data: { enabled: false } });
    renderSection({ enabled: true, available: true, hasPasskeys: false });

    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    expect(screen.queryByRole("button", { name: "Use a passkey instead" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("6-digit code from your app"), "654321");
    await user.click(screen.getByRole("button", { name: "Turn off authenticator app" }));

    expect(disableTotpWithCodeAction).toHaveBeenCalledWith("654321");
    expect(await screen.findByText("Authenticator app is off.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("when on and the account has a passkey, can turn off with the passkey instead", async () => {
    const user = userEvent.setup();
    const assertion = { id: "cred-1" };
    vi.mocked(passkeyStepUpOptionsAction).mockResolvedValue({
      ok: true,
      data: { challengeId: "chal-9", options: { challenge: "abc" } },
    });
    vi.mocked(startAuthentication).mockResolvedValue(assertion as never);
    vi.mocked(disableTotpWithPasskeyAction).mockResolvedValue({
      ok: true,
      data: { enabled: false },
    });
    renderSection({ enabled: true, available: true, hasPasskeys: true });

    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await user.click(screen.getByRole("button", { name: "Use a passkey instead" }));

    await waitFor(() => {
      expect(disableTotpWithPasskeyAction).toHaveBeenCalledWith("chal-9", assertion);
    });
    expect(disableTotpWithCodeAction).not.toHaveBeenCalled();
    expect(await screen.findByText("Authenticator app is off.")).toBeInTheDocument();
  });

  it("shows an inline message when the passkey prompt is cancelled", async () => {
    const user = userEvent.setup();
    vi.mocked(passkeyStepUpOptionsAction).mockResolvedValue({
      ok: true,
      data: { challengeId: "chal-9", options: { challenge: "abc" } },
    });
    vi.mocked(startAuthentication).mockRejectedValue(
      Object.assign(new Error("x"), { name: "NotAllowedError" }),
    );
    renderSection({ enabled: true, available: true, hasPasskeys: true });

    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await user.click(screen.getByRole("button", { name: "Use a passkey instead" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The passkey prompt was closed");
    expect(disableTotpWithPasskeyAction).not.toHaveBeenCalled();
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("hides the section when authenticator apps are switched off and it is not on", () => {
    const { container } = renderSection({ enabled: false, available: false, hasPasskeys: true });

    expect(screen.queryByRole("button", { name: "Set up" })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("when switched off but still on, shows it as on and only turns off with a passkey", async () => {
    const user = userEvent.setup();
    renderSection({ enabled: true, available: false, hasPasskeys: true });

    expect(screen.getByText("On")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Turn off" }));

    expect(screen.queryByLabelText("6-digit code from your app")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Turn off authenticator app" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use a passkey instead" })).toBeInTheDocument();
  });

  it("offers no way to turn it off with a code when switched off and there is no passkey", () => {
    renderSection({ enabled: true, available: false, hasPasskeys: false });

    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
  });

  it("asks to confirm it's you when setup needs a step-up, then retries setup", async () => {
    const user = userEvent.setup();
    vi.mocked(startTotpEnrolmentAction)
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "http", status: 403, code: "step_up_required", message: "step" },
      })
      .mockResolvedValueOnce({ ok: true, data: ENROLMENT });
    vi.mocked(passkeyStepUpOptionsAction).mockResolvedValue({
      ok: true,
      data: { challengeId: "chal-3", options: { challenge: "abc" } },
    });
    vi.mocked(startAuthentication).mockResolvedValue({ id: "cred-1" } as never);
    vi.mocked(stepUpAction).mockResolvedValue({
      ok: true,
      data: { steppedUp: true, expiresInSeconds: 600 },
    });
    renderSection({ enabled: false, available: true, hasPasskeys: true });

    await user.click(screen.getByRole("button", { name: "Set up" }));
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The app is not on yet, so a passkey is the only way to confirm here.
    expect(screen.queryByLabelText("6-digit code from your app")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use a passkey" }));

    expect(await screen.findByRole("img", { name: /QR code/ })).toBeInTheDocument();
    expect(stepUpAction).toHaveBeenCalledWith({
      challengeId: "chal-3",
      response: { id: "cred-1" },
    });
    expect(startTotpEnrolmentAction).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Confirm it's you")).not.toBeInTheDocument();
  });
});
