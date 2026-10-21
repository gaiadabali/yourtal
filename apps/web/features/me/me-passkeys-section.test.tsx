import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import enAU from "@/messages/en-AU/me.json";
import { MePasskeysSection } from "./me-passkeys-section";
import {
  registerPasskeyAction,
  registerPasskeyOptionsAction,
  passkeyStepUpOptionsAction,
  removePasskeyAction,
  signInAgainAction,
  stepUpAction,
} from "./sign-in-methods-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock("./sign-in-methods-actions", () => ({
  registerPasskeyOptionsAction: vi.fn(),
  registerPasskeyAction: vi.fn(),
  removePasskeyAction: vi.fn(),
  passkeyStepUpOptionsAction: vi.fn(),
  stepUpAction: vi.fn(),
  signInAgainAction: vi.fn(),
}));

const LAPTOP = {
  id: "p1",
  name: "Work laptop",
  createdAt: "2026-10-01T01:00:00.000Z",
  lastUsedAt: "2026-10-20T01:00:00.000Z",
  synced: true,
};
const PHONE = {
  id: "p2",
  name: "Passkey",
  createdAt: "2026-10-02T01:00:00.000Z",
  lastUsedAt: null,
  synced: false,
};

function renderSection(
  passkeys: React.ComponentProps<typeof MePasskeysSection>["initialPasskeys"],
  appCodeAvailable = false,
) {
  return render(
    <NextIntlClientProvider locale="en-AU" timeZone="Australia/Sydney" messages={{ me: enAU }}>
      <MePasskeysSection initialPasskeys={passkeys} appCodeAvailable={appCodeAvailable} />
    </NextIntlClientProvider>,
  );
}

describe("MePasskeysSection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
  });

  it("lists each passkey with its dates and a synced badge only where it applies", () => {
    renderSection([LAPTOP, PHONE]);

    const [laptopRow, phoneRow] = screen.getAllByRole("listitem");
    expect(laptopRow).toHaveTextContent("Work laptop");
    expect(laptopRow).toHaveTextContent("Synced");
    expect(laptopRow).toHaveTextContent("Added 1 Oct 2026");
    expect(laptopRow).toHaveTextContent("Last used 20 Oct 2026");
    expect(phoneRow).not.toHaveTextContent("Synced");
    expect(phoneRow).toHaveTextContent("Not used yet");
  });

  it("removes a passkey only after a confirm step, then refreshes", async () => {
    const user = userEvent.setup();
    vi.mocked(removePasskeyAction).mockResolvedValue({ ok: true, data: { removed: true } });
    renderSection([LAPTOP, PHONE]);

    await user.click(screen.getByRole("button", { name: "Remove Work laptop" }));
    expect(removePasskeyAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove passkey" }));

    expect(removePasskeyAction).toHaveBeenCalledWith("p1");
    await waitFor(() => {
      expect(screen.queryByText("Work laptop")).not.toBeInTheDocument();
    });
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Passkey removed.");
  });

  it("Cancel in the confirm step leaves the passkey alone", async () => {
    const user = userEvent.setup();
    renderSection([LAPTOP]);

    await user.click(screen.getByRole("button", { name: "Remove Work laptop" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(removePasskeyAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove Work laptop" })).toBeInTheDocument();
  });

  it("explains why the last sign-in method cannot be removed and keeps the row", async () => {
    const user = userEvent.setup();
    vi.mocked(removePasskeyAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 409, code: "last_sign_in_method", message: "last" },
    });
    renderSection([LAPTOP]);

    await user.click(screen.getByRole("button", { name: "Remove Work laptop" }));
    await user.click(screen.getByRole("button", { name: "Remove passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Keep at least one way to sign in");
    expect(screen.getByText("Work laptop")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("adds a passkey with the optional name, then refreshes", async () => {
    const user = userEvent.setup();
    vi.mocked(registerPasskeyOptionsAction).mockResolvedValue({
      ok: true,
      data: { options: { challenge: "abc" } },
    });
    vi.mocked(startRegistration).mockResolvedValue({ id: "cred-1" } as never);
    vi.mocked(registerPasskeyAction).mockResolvedValue({ ok: true, data: PHONE });
    renderSection([]);

    expect(screen.getByText("No passkeys yet.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name (optional)"), "Home desktop");
    await user.click(screen.getByRole("button", { name: "Add a passkey" }));

    await waitFor(() => {
      expect(registerPasskeyAction).toHaveBeenCalledWith({ id: "cred-1" }, "Home desktop");
    });
    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByText("Passkey added.")).toBeInTheDocument();
  });

  it("says to sign in again when the session is too old, and offers to do it", async () => {
    const user = userEvent.setup();
    vi.mocked(registerPasskeyOptionsAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 403, code: "reauthentication_required", message: "old" },
    });
    renderSection([]);

    await user.click(screen.getByRole("button", { name: "Add a passkey" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("sign in again before changing this");
    expect(within(alert).getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
    expect(signInAgainAction).not.toHaveBeenCalled();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it("shows a quiet message instead of the add form when the browser has no passkeys", () => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    renderSection([LAPTOP]);

    expect(screen.queryByRole("button", { name: "Add a passkey" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("can't create passkeys");
  });

  it("adding a passkey that needs a step-up confirms with a passkey, then retries the add", async () => {
    const user = userEvent.setup();
    const stepUpRefusal = {
      ok: false as const,
      error: { kind: "http" as const, status: 403, code: "step_up_required", message: "step" },
    };
    vi.mocked(registerPasskeyOptionsAction)
      .mockResolvedValueOnce(stepUpRefusal)
      .mockResolvedValueOnce({ ok: true, data: { options: { challenge: "abc" } } });
    vi.mocked(passkeyStepUpOptionsAction).mockResolvedValue({
      ok: true,
      data: { challengeId: "chal-1", options: { challenge: "def" } },
    });
    vi.mocked(startAuthentication).mockResolvedValue({ id: "cred-auth" } as never);
    vi.mocked(stepUpAction).mockResolvedValue({
      ok: true,
      data: { steppedUp: true, expiresInSeconds: 600 },
    });
    vi.mocked(startRegistration).mockResolvedValue({ id: "cred-new" } as never);
    vi.mocked(registerPasskeyAction).mockResolvedValue({ ok: true, data: PHONE });
    renderSection([LAPTOP]);

    await user.click(screen.getByRole("button", { name: "Add a passkey" }));
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument();
    expect(startRegistration).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use a passkey" }));

    expect(await screen.findByText("Passkey added.")).toBeInTheDocument();
    expect(stepUpAction).toHaveBeenCalledWith({
      challengeId: "chal-1",
      response: { id: "cred-auth" },
    });
    expect(registerPasskeyOptionsAction).toHaveBeenCalledTimes(2);
    expect(registerPasskeyAction).toHaveBeenCalledWith({ id: "cred-new" }, "");
    expect(screen.queryByText("Confirm it's you")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("removing a passkey that needs a step-up confirms with a code, then retries the removal", async () => {
    const user = userEvent.setup();
    vi.mocked(removePasskeyAction)
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "http", status: 403, code: "step_up_required", message: "step" },
      })
      .mockResolvedValueOnce({ ok: true, data: { removed: true } });
    vi.mocked(stepUpAction).mockResolvedValue({
      ok: true,
      data: { steppedUp: true, expiresInSeconds: 600 },
    });
    renderSection([LAPTOP, PHONE], true);

    await user.click(screen.getByRole("button", { name: "Remove Work laptop" }));
    await user.click(screen.getByRole("button", { name: "Remove passkey" }));
    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument();
    expect(screen.getByText("Work laptop")).toBeInTheDocument();

    await user.type(screen.getByLabelText("6-digit code from your app"), "123 456");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.queryByText("Work laptop")).not.toBeInTheDocument();
    });
    expect(stepUpAction).toHaveBeenCalledWith({ code: "123456" });
    expect(removePasskeyAction).toHaveBeenCalledTimes(2);
    expect(removePasskeyAction).toHaveBeenLastCalledWith("p1");
    expect(screen.getByRole("status")).toHaveTextContent("Passkey removed.");
  });

  it("shows the wrong-code message and does not retry when the step-up code is refused", async () => {
    const user = userEvent.setup();
    vi.mocked(removePasskeyAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 403, code: "step_up_required", message: "step" },
    });
    vi.mocked(stepUpAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 401, code: "factor_invalid", message: "bad" },
    });
    renderSection([LAPTOP], true);

    await user.click(screen.getByRole("button", { name: "Remove Work laptop" }));
    await user.click(screen.getByRole("button", { name: "Remove passkey" }));
    await user.type(await screen.findByLabelText("6-digit code from your app"), "000000");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work");
    expect(removePasskeyAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Confirm it's you")).toBeInTheDocument();
  });

  it("tells the person to sign in again when there is no passkey or app to confirm with", async () => {
    const user = userEvent.setup();
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    vi.mocked(removePasskeyAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 403, code: "step_up_required", message: "step" },
    });
    renderSection([LAPTOP], false);

    await user.click(screen.getByRole("button", { name: "Remove Work laptop" }));
    await user.click(screen.getByRole("button", { name: "Remove passkey" }));

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Sign in again with your passkey or authenticator app");
    expect(within(notice).getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });

  it("says the prompt was closed when the passkey step-up is cancelled, without retrying", async () => {
    const user = userEvent.setup();
    vi.mocked(removePasskeyAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 403, code: "step_up_required", message: "step" },
    });
    vi.mocked(passkeyStepUpOptionsAction).mockResolvedValue({
      ok: true,
      data: { challengeId: "chal-1", options: { challenge: "def" } },
    });
    vi.mocked(startAuthentication).mockRejectedValue(
      Object.assign(new Error("x"), { name: "NotAllowedError" }),
    );
    renderSection([LAPTOP], false);

    await user.click(screen.getByRole("button", { name: "Remove Work laptop" }));
    await user.click(screen.getByRole("button", { name: "Remove passkey" }));
    await user.click(await screen.findByRole("button", { name: "Use a passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The passkey prompt was closed");
    expect(stepUpAction).not.toHaveBeenCalled();
    expect(removePasskeyAction).toHaveBeenCalledTimes(1);
  });
});
