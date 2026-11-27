import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enStaff from "@/messages/en-AU/staff.json";
import idStaff from "@/messages/id-ID/staff.json";
import { SpambankAutoreplyControls } from "./spambank-autoreply-controls";
import { SpambankLeadsList } from "./spambank-leads-list";
import { SpambankOptoutConfirm } from "./spambank-optout-confirm";
import { changeAutoreplyAction, updateLeadAction } from "./spambank-staff-actions";
import { optOutAction } from "./spambank-optout-actions";
import type { SpambankLead } from "./spambank-staff-contract";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./spambank-staff-actions", () => ({
  updateLeadAction: vi.fn(),
  changeAutoreplyAction: vi.fn(),
}));
vi.mock("./spambank-optout-actions", () => ({ optOutAction: vi.fn() }));

type Locale = "en-AU" | "id-ID";

function intl(ui: ReactElement, locale: Locale = "en-AU") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ staff: locale === "en-AU" ? enStaff : idStaff }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const lead = (overrides: Partial<SpambankLead> = {}): SpambankLead => ({
  orgDomain: "brightbrews.com.au",
  displayName: "Bright Brews",
  sampleFrom: "hello@news.brightbrews.com.au",
  sampleSubject: "Spring sale: 30% off",
  recipients: 4,
  messages: 9,
  firstSeenAt: "2026-11-20T03:00:00.000Z",
  lastSeenAt: "2026-11-27T03:00:00.000Z",
  status: "new",
  note: null,
  autoRepliedAt: null,
  optedOutAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.mocked(updateLeadAction).mockReset();
  vi.mocked(changeAutoreplyAction).mockReset();
  vi.mocked(optOutAction).mockReset();
  refresh.mockReset();
});

describe("the leads list", () => {
  it("shows a brand with its counts, status and an opted-out mark", () => {
    intl(
      <SpambankLeadsList
        initial={[
          lead(),
          lead({
            orgDomain: "oldnews.example",
            displayName: null,
            optedOutAt: "2026-11-25T03:00:00.000Z",
            autoRepliedAt: "2026-11-24T03:00:00.000Z",
            status: "ignored",
          }),
        ]}
        region="AU"
        canEdit
      />,
    );
    const table = screen.getByRole("table", {
      name: /Brands that emailed Spambank users in Australia/,
    });
    expect(within(table).getByText("Bright Brews")).toBeInTheDocument();
    expect(within(table).getAllByText("Spring sale: 30% off")[0]).toBeInTheDocument();
    expect(within(table).getByText("Opted out 25 Nov 2026")).toBeInTheDocument();
    expect(within(table).getByText("Ignored")).toBeInTheDocument();
  });

  it("says so when there are no leads", () => {
    intl(<SpambankLeadsList initial={[]} region="AU" canEdit />);
    expect(screen.getByText("No leads found")).toBeInTheDocument();
  });

  it("hides the edit button from a read-only role", () => {
    intl(<SpambankLeadsList initial={[lead()]} region="AU" canEdit={false} />);
    expect(screen.queryByRole("button", { name: /Edit status and note/ })).not.toBeInTheDocument();
  });

  it("saves a status and note and shows them on the row", async () => {
    vi.mocked(updateLeadAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    intl(<SpambankLeadsList initial={[lead()]} region="AU" canEdit />);
    await user.click(
      screen.getAllByRole("button", { name: /Edit status and note for brightbrews/ })[0]!,
    );
    await user.selectOptions(screen.getByLabelText("Status"), "contacted");
    await user.type(screen.getByLabelText("Note for the sales team"), "Called Tuesday");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateLeadAction).toHaveBeenCalledWith(
        "brightbrews.com.au",
        "contacted",
        "Called Tuesday",
      ),
    );
    await waitFor(() => expect(screen.getAllByText("Contacted").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Called Tuesday").length).toBeGreaterThan(0);
  });

  it("reads in Indonesian", () => {
    intl(<SpambankLeadsList initial={[lead()]} region="ID" canEdit />, "id-ID");
    expect(screen.getAllByText("Baru").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Belum dibalas").length).toBeGreaterThan(0);
  });
});

describe("the auto-reply controls", () => {
  it("trips the kill switch with a reason, then refreshes the page", async () => {
    vi.mocked(changeAutoreplyAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    intl(<SpambankAutoreplyControls tripped={false} paused={false} dailyCap={200} />);
    expect(screen.queryByRole("button", { name: "Resume after pause" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop auto-replies" }));
    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Stop auto-replies" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), "Complaint from a brand");
    await user.click(submit);
    await waitFor(() =>
      expect(changeAutoreplyAction).toHaveBeenCalledWith({
        tripped: true,
        reason: "Complaint from a brand",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("offers resume only while paused, and sends resume without touching the switch", async () => {
    vi.mocked(changeAutoreplyAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    intl(<SpambankAutoreplyControls tripped paused dailyCap={200} />);
    expect(screen.getByRole("button", { name: "Allow auto-replies" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume after pause" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Reason/), "Blocklist cleared");
    await user.click(within(dialog).getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(changeAutoreplyAction).toHaveBeenCalledWith({
        resume: true,
        reason: "Blocklist cleared",
      }),
    );
  });

  it("changes the daily cap only with a valid number and a reason", async () => {
    vi.mocked(changeAutoreplyAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    intl(<SpambankAutoreplyControls tripped={false} paused={false} dailyCap={200} />);
    const save = screen.getByRole("button", { name: "Save daily cap" });
    expect(save).toBeDisabled();
    const cap = screen.getByLabelText("Daily cap");
    await user.clear(cap);
    await user.type(cap, "1");
    await user.type(screen.getByLabelText(/Reason/), "Warm-up week");
    await user.click(save);
    await waitFor(() =>
      expect(changeAutoreplyAction).toHaveBeenCalledWith({ dailyCap: 1, reason: "Warm-up week" }),
    );
  });

  it("shows an error and does not refresh when the API refuses", async () => {
    vi.mocked(changeAutoreplyAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 403, code: "forbidden", message: "no" },
    });
    const user = userEvent.setup();
    intl(<SpambankAutoreplyControls tripped={false} paused={false} dailyCap={200} />);
    await user.click(screen.getByRole("button", { name: "Stop auto-replies" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Reason/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Stop auto-replies" }));
    await waitFor(() => expect(screen.getByText(/could not be completed/)).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the opt-out confirm button", () => {
  it("does nothing until pressed, then says done", async () => {
    vi.mocked(optOutAction).mockResolvedValue("done");
    const user = userEvent.setup();
    intl(<SpambankOptoutConfirm domain="brightbrews.com.au" sig="abcdefghijklmnopqrstuv" />);
    expect(optOutAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Stop replies to brightbrews.com.au" }));
    expect(optOutAction).toHaveBeenCalledWith("brightbrews.com.au", "abcdefghijklmnopqrstuv");
    expect(
      await screen.findByText("brightbrews.com.au will not get another automatic reply from us."),
    ).toBeInTheDocument();
  });

  it("keeps the button when the server is unavailable so it can be tried again", async () => {
    vi.mocked(optOutAction).mockResolvedValue("unavailable");
    const user = userEvent.setup();
    intl(<SpambankOptoutConfirm domain="brightbrews.com.au" sig="abcdefghijklmnopqrstuv" />);
    await user.click(screen.getByRole("button", { name: "Stop replies to brightbrews.com.au" }));
    expect(await screen.findByText("That did not go through. Try again.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stop replies to brightbrews.com.au" }),
    ).toBeInTheDocument();
  });

  it("reads in Indonesian", () => {
    intl(<SpambankOptoutConfirm domain="tokobaik.co.id" sig="abcdefghijklmnopqrstuv" />, "id-ID");
    expect(
      screen.getByRole("button", { name: "Hentikan balasan untuk tokobaik.co.id" }),
    ).toBeInTheDocument();
  });
});
