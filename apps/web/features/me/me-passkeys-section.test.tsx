import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import enAU from "@/messages/en-AU/me.json";
import { MePasskeysSection } from "./me-passkeys-section";
import {
  registerPasskeyAction,
  registerPasskeyOptionsAction,
  removePasskeyAction,
  signInAgainAction,
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
) {
  return render(
    <NextIntlClientProvider locale="en-AU" timeZone="Australia/Sydney" messages={{ me: enAU }}>
      <MePasskeysSection initialPasskeys={passkeys} />
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
});
