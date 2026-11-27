import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSpambank from "@/messages/en-AU/spambank.json";
import idSpambank from "@/messages/id-ID/spambank.json";
import { MeMailSection } from "./me-mail-section";
import { SwitchOn } from "./switch-on";
import * as actions from "./spambank-actions";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: nav.refresh }),
  usePathname: () => "/me",
}));
vi.mock("./spambank-actions", () => ({
  mintMailSessionAction: vi.fn(),
  enableMailboxAction: vi.fn(),
  listAppPasswordsAction: vi.fn(),
  createAppPasswordAction: vi.fn(),
  revokeAppPasswordAction: vi.fn(),
  deleteMailboxAction: vi.fn(),
}));

const ADDRESS = "geewizduck@yourtal.gaiada.com";
const created = {
  id: "ap1",
  name: "Pixel mail",
  createdAt: "2026-11-28T01:00:00Z",
  secret: "app_s3cr3t",
  username: ADDRESS,
  imap: { host: "mail.yourtal.gaiada.com", port: 993, security: "ssl" as const },
  smtp: { host: "mail.yourtal.gaiada.com", port: 465, security: "ssl" as const },
};

function renderIntl(ui: ReactElement, locale: "en-AU" | "id-ID" = "en-AU") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ spambank: locale === "id-ID" ? idSpambank : enSpambank }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  nav.refresh.mockReset();
  vi.mocked(actions.listAppPasswordsAction).mockResolvedValue({ ok: true, data: { items: [] } });
});

describe("switching mail on", () => {
  it("shows the generated address, then opens the inbox", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.enableMailboxAction).mockResolvedValue({
      ok: true,
      data: { state: "on", address: ADDRESS, created: true },
    });
    renderIntl(<SwitchOn />);
    await user.click(screen.getByRole("button", { name: "Switch on mail" }));
    expect(await screen.findByTestId("new-address")).toHaveTextContent(ADDRESS);
    await user.click(screen.getByRole("button", { name: "Open your inbox" }));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("explains a refusal for a non-adult, and any other failure, in words", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.enableMailboxAction).mockResolvedValueOnce({
      ok: false,
      error: { kind: "http", status: 403, code: "not_allowed", message: "no" },
    });
    renderIntl(<SwitchOn />);
    await user.click(screen.getByRole("button", { name: "Switch on mail" }));
    expect(await screen.findByText(/Mail is for adult accounts/)).toBeInTheDocument();
    vi.mocked(actions.enableMailboxAction).mockResolvedValueOnce({
      ok: false,
      error: { kind: "network", message: "offline" },
    });
    await user.click(screen.getByRole("button", { name: "Switch on mail" }));
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
  });
});

describe("Me: mail settings", () => {
  it("points to the switch-on screen when there is no mailbox yet", () => {
    renderIntl(<MeMailSection address={null} />);
    expect(screen.getByRole("link", { name: "Get your inbox" })).toHaveAttribute("href", "/mail");
  });

  it("shows the address and storage", () => {
    renderIntl(
      <MeMailSection
        address={ADDRESS}
        quota={{ limitBytes: 2_000_000_000, usedBytes: 500_000_000 }}
      />,
    );
    expect(screen.getByTestId("settings-address")).toHaveTextContent(ADDRESS);
    expect(screen.getByText("500 MB of 2.0 GB used")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Storage used" })).toBeInTheDocument();
  });

  it("creates an app password, shows the secret once, and lists it without the secret", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.createAppPasswordAction).mockResolvedValue({ ok: true, data: created });
    renderIntl(<MeMailSection address={ADDRESS} />);
    await screen.findByText("No app passwords yet.");
    await user.type(screen.getByLabelText("Name"), "Pixel mail");
    await user.click(screen.getByRole("button", { name: "Create app password" }));
    expect(actions.createAppPasswordAction).toHaveBeenCalledWith("Pixel mail");
    const secret = await screen.findByTestId("app-password-secret");
    expect(secret).toHaveTextContent("app_s3cr3t");
    expect(secret).toHaveTextContent("mail.yourtal.gaiada.com · port 993 · SSL/TLS");
    expect(secret).toHaveTextContent("mail.yourtal.gaiada.com · port 465 · SSL/TLS");
    expect(secret).toHaveTextContent("only time");
    await user.click(within(secret).getByRole("button", { name: /copied it/ }));
    expect(screen.queryByTestId("app-password-secret")).not.toBeInTheDocument();
    const list = screen.getByTestId("app-password-list");
    expect(list).toHaveTextContent("Pixel mail");
    expect(list).not.toHaveTextContent("app_s3cr3t");
  });

  it("revokes an app password after a confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.listAppPasswordsAction).mockResolvedValue({
      ok: true,
      data: { items: [{ id: "ap1", name: "Pixel mail", createdAt: "2026-11-20T01:00:00Z" }] },
    });
    vi.mocked(actions.revokeAppPasswordAction).mockResolvedValue({ ok: true, data: undefined });
    renderIntl(<MeMailSection address={ADDRESS} />);
    await user.click(await screen.findByRole("button", { name: "Revoke Pixel mail" }));
    expect(screen.getByText("The phone using it will stop receiving mail.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(actions.revokeAppPasswordAction).toHaveBeenCalledWith("ap1");
    await waitFor(() => expect(screen.queryByTestId("app-password-list")).not.toBeInTheDocument());
  });

  it("stops offering a sixth app password", async () => {
    vi.mocked(actions.listAppPasswordsAction).mockResolvedValue({
      ok: true,
      data: {
        items: Array.from({ length: 5 }, (_, i) => ({
          id: `ap${i}`,
          name: `Phone ${i}`,
          createdAt: "2026-11-20T01:00:00Z",
        })),
      },
    });
    renderIntl(<MeMailSection address={ADDRESS} />);
    expect(await screen.findByText("Limit reached")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create app password" })).not.toBeInTheDocument();
  });

  it("deletes the mailbox only after the person confirms", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.deleteMailboxAction).mockResolvedValue({ ok: true, data: undefined });
    renderIntl(<MeMailSection address={ADDRESS} />);
    await user.click(screen.getByRole("button", { name: "Delete mailbox" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete mailbox" });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(confirm);
    expect(actions.deleteMailboxAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
  });

  it("reads in Bahasa Indonesia", async () => {
    renderIntl(<MeMailSection address={ADDRESS} />, "id-ID");
    expect(screen.getByRole("heading", { name: "Aplikasi email di ponsel" })).toBeInTheDocument();
    expect(await screen.findByText("Belum ada kata sandi aplikasi.")).toBeInTheDocument();
  });
});
