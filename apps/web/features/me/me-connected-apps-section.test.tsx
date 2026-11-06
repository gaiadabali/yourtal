import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/me.json";
import idID from "@/messages/id-ID/me.json";
import { MeConnectedAppsSection } from "./me-connected-apps-section";
import { removeConnectedAppAction } from "./me-actions";

vi.mock("./me-actions", () => ({ removeConnectedAppAction: vi.fn() }));

const SNAP = {
  app: "snapapp" as const,
  name: "SnapApp",
  operator: "Snap Apps Pty Ltd",
  scopes: ["openid", "profile", "email"],
  grantedAt: "2026-10-20T01:00:00Z",
};
const FTR = {
  ...SNAP,
  app: "ftr" as const,
  name: "Free Tax Returns",
  operator: "Benjamin Charles Group",
};

function renderSection(props: Parameters<typeof MeConnectedAppsSection>[0]) {
  return render(
    <NextIntlClientProvider locale="en-AU" timeZone="Australia/Sydney" messages={{ me: enAU }}>
      <MeConnectedAppsSection {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.mocked(removeConnectedAppAction).mockReset());

describe("MeConnectedAppsSection (docs/29 Y5)", () => {
  it("lists each app with its operator, date and what it gets, and a Remove for each", () => {
    renderSection({ initialApps: [SNAP, FTR], isTeen: false });

    expect(screen.getByRole("heading", { name: "Apps you sign in to with YourTal" })).toBeVisible();
    expect(screen.getByText("SnapApp")).toBeInTheDocument();
    expect(screen.getByText("Free Tax Returns")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Run by Benjamin Charles Group\. Signed in since 20 Oct 2026\. Gets your name, email, age group and country\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);
  });

  it("shows the empty state when no app is connected", () => {
    renderSection({ initialApps: [], isTeen: false });

    expect(screen.getByText("No apps yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("asks an adult with the adult copy, and Cancel removes nothing", async () => {
    const user = userEvent.setup();
    renderSection({ initialApps: [SNAP], isTeen: false });

    await user.click(screen.getByRole("button", { name: "Remove SnapApp" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove SnapApp?" });
    expect(dialog).toHaveTextContent(
      "You'll be signed out of SnapApp, and it can't sign you in with YourTal until you agree again. Your SnapApp account and data stay with SnapApp, and you can delete them there.",
    );
    expect(dialog).not.toHaveTextContent("30 days");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(removeConnectedAppAction).not.toHaveBeenCalled();
    expect(screen.getByText("SnapApp")).toBeInTheDocument();
  });

  it("asks a teen with the teen copy", async () => {
    const user = userEvent.setup();
    renderSection({ initialApps: [SNAP], isTeen: true });

    await user.click(screen.getByRole("button", { name: "Remove SnapApp" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Your SnapApp space will be deleted after 30 days, and you'll need a new invite from your parent to use SnapApp again.",
    );
  });

  it("removes the app, then shows the list the server returns", async () => {
    vi.mocked(removeConnectedAppAction).mockResolvedValue({
      ok: true,
      data: { connectedApps: [FTR] },
    });
    const user = userEvent.setup();
    renderSection({ initialApps: [SNAP, FTR], isTeen: false });

    await user.click(screen.getByRole("button", { name: "Remove SnapApp" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(removeConnectedAppAction).toHaveBeenCalledWith("snapapp");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("SnapApp")).not.toBeInTheDocument();
    expect(screen.getByText("Free Tax Returns")).toBeInTheDocument();
  });

  it("keeps the app and says so when the removal fails, and the error is gone on reopening", async () => {
    vi.mocked(removeConnectedAppAction).mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "down" },
    });
    const user = userEvent.setup();
    renderSection({ initialApps: [SNAP], isTeen: false });

    await user.click(screen.getByRole("button", { name: "Remove SnapApp" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("That didn't work");
    expect(screen.getByText("SnapApp")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Remove SnapApp" }));
    expect(within(await screen.findByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("connectedApps strings", () => {
  it("id-ID keeps every placeholder the en-AU string has", () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const [key, en] of Object.entries(enAU.connectedApps)) {
      const id = (idID.connectedApps as Record<string, string>)[key];
      expect(id, key).toBeTypeOf("string");
      expect(placeholders(id as string), key).toEqual(placeholders(en));
    }
  });
});
