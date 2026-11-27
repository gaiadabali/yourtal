import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IFRAME_SANDBOX } from "@yourtal/mail-engine";
import { createMemoryMailClient } from "@yourtal/mail-engine/testing";
import enNav from "@/messages/en-AU/nav.json";
import enSpambank from "@/messages/en-AU/spambank.json";
import idSpambank from "@/messages/id-ID/spambank.json";
import { MailNavLink } from "./mail-nav-link";
import { setSharedMailClient } from "./mail-client";
import { MailRoot } from "./mail-root";
import { MailRoutesView } from "./mail-routes-view";
import { MailShell } from "./mail-shell";
import type { MailRoute } from "./mail-routes";

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: "/mail" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: vi.fn() }),
  usePathname: () => nav.pathname,
}));
vi.mock("./spambank-actions", () => ({ mintMailSessionAction: vi.fn() }));

const ADDRESS = "geewizduck@yourtal.gaiada.com";

function renderMail(ui: ReactElement, opts: { locale?: "en-AU" | "id-ID" } = {}) {
  const memory = createMemoryMailClient();
  // The nav badge loads on its own and reads the tab's shared client.
  setSharedMailClient(memory);
  const locale = opts.locale ?? "en-AU";
  const messages = { spambank: locale === "id-ID" ? idSpambank : enSpambank, nav: enNav };
  const view = render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <MailRoot client={memory}>{ui}</MailRoot>
    </NextIntlClientProvider>,
  );
  return { ...view, memory: () => memory };
}

const screenFor = (route: MailRoute) => (
  <MailShell address={ADDRESS}>
    <MailRoutesView route={route} />
  </MailShell>
);

afterEach(() => setSharedMailClient(null));

beforeEach(() => {
  // jsdom has no matchMedia; the reader asks it whether the page is dark.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  nav.push.mockReset();
  nav.pathname = "/mail";
});

describe("the Inbox", () => {
  it("lists the fixture mail, with the address, folders and unread badge", async () => {
    renderMail(screenFor({ view: "folder", folder: "inbox" }));
    expect(await screen.findByText("Lunch on Friday?")).toBeInTheDocument();
    expect(screen.getAllByTestId("mail-row")).toHaveLength(8);
    expect(screen.getByTestId("mail-address")).toHaveTextContent(ADDRESS);
    const folders = screen.getByRole("navigation", { name: "Mail folders" });
    expect(within(folders).getByRole("link", { name: /^Inbox/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(folders).getByRole("link", { name: "Mail settings" })).toHaveAttribute(
      "href",
      "/me#mail",
    );
    // Three unread inbox messages in the fixture.
    expect(within(folders).getByRole("link", { name: /^Inbox/ })).toHaveTextContent("3");
  });

  it("moves a selected message to Spam and says so", async () => {
    const user = userEvent.setup();
    renderMail(screenFor({ view: "folder", folder: "inbox" }));
    await screen.findByText("Lunch on Friday?");
    await user.click(
      screen.getByRole("checkbox", { name: /Select message from Maria Santos: Lunch on Friday\?/ }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Move selected messages to" }),
      "spam",
    );
    expect(await screen.findByText("Moved 1 message to Spam.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Lunch on Friday?")).not.toBeInTheDocument());
  });

  it("deletes to Trash, and asks before deleting for good from Trash", async () => {
    const user = userEvent.setup();
    renderMail(screenFor({ view: "folder", folder: "trash" }));
    await screen.findByText("Your subscription has ended");
    await user.click(screen.getByRole("checkbox", { name: "Select all messages shown" }));
    await user.click(screen.getByRole("button", { name: "Delete forever" }));
    expect(screen.getByText("Delete 2 messages forever?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete forever" }));
    expect(await screen.findByText("Deleted 2 messages.")).toBeInTheDocument();
  });
});

describe("Spam", () => {
  it("shows the YourTal banner and the three counters above the list", async () => {
    renderMail(screenFor({ view: "folder", folder: "spam" }));
    const banner = await screen.findByTestId("spam-banner");
    expect(within(banner).getByText("From YourTal")).toBeInTheDocument();
    expect(within(banner).getByRole("link", { name: /Advertise on YourTal/ })).toHaveAttribute(
      "href",
      "https://yourtal.gaiada.com/studio/onboarding",
    );
    expect(within(banner).getByText("Bulk mail filed, last 30 days")).toBeInTheDocument();
    expect(await screen.findByText("You have WON $1,000,000!!!")).toBeInTheDocument();
  });
});

describe("the reader", () => {
  it("shows HTML only in an iframe whose sandbox is the engine's, with no scripts and no remote image", async () => {
    renderMail(screenFor({ view: "message", id: "m2" }));
    const frame = await screen.findByTestId("mail-html-frame");
    expect(frame).toHaveAttribute("sandbox", IFRAME_SANDBOX);
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    const doc = frame.getAttribute("srcdoc") ?? "";
    expect(doc.startsWith("<!doctype html><html><head><meta http-equiv=")).toBe(true);
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/src=["']https?:/i);
    // The attachment is listed outside the frame, as a download.
    expect(screen.getByRole("button", { name: /Download checklist\.pdf/ })).toBeInTheDocument();
  });

  it("marks the message read when it is opened", async () => {
    const view = renderMail(screenFor({ view: "message", id: "m1" }));
    await screen.findByText("Hi Gee,", { exact: false });
    await waitFor(async () => {
      const detail = await view.memory().get("m1");
      expect(detail.unread).toBe(false);
    });
  });

  it("unsubscribes from a mailing list in one tap", async () => {
    const user = userEvent.setup();
    const view = renderMail(screenFor({ view: "message", id: "m12" }));
    await user.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByTestId("unsubscribe-done")).toHaveTextContent("Unsubscribed.");
    expect((await view.memory().summary()).counters.marketersUnsubscribed).toBeGreaterThan(0);
  });

  it("moves a message to Trash and goes back to its folder", async () => {
    const user = userEvent.setup();
    renderMail(screenFor({ view: "message", id: "m5" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/mail"));
  });

  it("reads the same screens in Bahasa Indonesia", async () => {
    renderMail(screenFor({ view: "folder", folder: "inbox" }), { locale: "id-ID" });
    await screen.findByText("Lunch on Friday?");
    const folders = screen.getByRole("navigation", { name: "Folder email" });
    expect(within(folders).getByRole("link", { name: /^Kotak masuk/ })).toBeInTheDocument();
    expect(within(folders).getByRole("link", { name: /^Promosi/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tulis email" })).toBeInTheDocument();
  });
});

describe("compose", () => {
  it("sends a new message with an attachment and lands in Sent", async () => {
    const user = userEvent.setup();
    const view = renderMail(screenFor({ view: "compose", mode: "new", id: null }));
    await user.type(await screen.findByLabelText("To"), "maria@example.com");
    await user.type(screen.getByLabelText("Subject"), "Hello from YourTal");
    await user.type(screen.getByLabelText("Message"), "Test body");
    await user.upload(
      screen.getByLabelText("Attach files", { selector: "input" }),
      new File(["abc"], "note.txt", { type: "text/plain" }),
    );
    expect(await screen.findByText("note.txt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/mail/sent"));
    const sent = await view.memory().list("sent");
    const mine = sent.items.find((m) => m.subject === "Hello from YourTal");
    expect(mine).toBeDefined();
    expect(mine?.hasAttachment).toBe(true);
  });

  it("refuses an empty recipient list and a bad address, in words", async () => {
    const user = userEvent.setup();
    renderMail(screenFor({ view: "compose", mode: "new", id: null }));
    await user.click(await screen.findByRole("button", { name: "Send" }));
    expect(await screen.findByText("Add at least one recipient.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("To"), "not-an-address");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByText(/This isn't an email address: not-an-address/),
    ).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("replies with the sender filled in and the quote below", async () => {
    renderMail(screenFor({ view: "compose", mode: "reply", id: "m1" }));
    expect(await screen.findByLabelText("To")).toHaveValue("Maria Santos <maria@example.com>");
    expect(screen.getByLabelText("Subject")).toHaveValue("Re: Lunch on Friday?");
    const body = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
    expect(body.value).toContain("wrote:");
  });

  it("forwards with the original attachment carried over", async () => {
    renderMail(screenFor({ view: "compose", mode: "forward", id: "m2" }));
    expect(await screen.findByLabelText("Subject")).toHaveValue(
      "Fwd: Your 2025-26 tax return checklist",
    );
    expect(await screen.findByText("checklist.pdf")).toBeInTheDocument();
  });
});

describe("the nav badge", () => {
  it("rises when new mail arrives, on the same client the screens use", async () => {
    const view = renderMail(
      <MailNavLink locale="en-AU" on variant="rail" className="x" activeClassName="active" />,
    );
    const badge = await screen.findByTestId("mail-unread-badge");
    expect(badge).toHaveTextContent("3");
    await act(async () => {
      view.memory().deliver({ subject: "Fresh", unread: true });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("mail-unread-badge")).toHaveTextContent("4"));
    expect(screen.getByText("4 unread messages")).toBeInTheDocument();
  });

  it("is a plain link with no badge before the mailbox is switched on", () => {
    render(
      <NextIntlClientProvider locale="en-AU" messages={{ nav: enNav }}>
        <MailNavLink locale="en-AU" on={false} variant="menu" className="x" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link", { name: "Mail" })).toHaveAttribute("href", "/mail");
    expect(screen.queryByTestId("mail-unread-badge")).not.toBeInTheDocument();
  });
});
