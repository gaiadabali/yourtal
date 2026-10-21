import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParkedPurchase } from "@yourtal/contracts/staff/parked-purchases";
import type { MinorUnits, Points } from "@yourtal/contracts/money";
import enStaff from "@/messages/en-AU/staff.json";
import idStaff from "@/messages/id-ID/staff.json";
import { StaffParkedPurchasesScreen } from "./staff-parked-purchases-screen";
import { decideRefundAction, proposeRefundAction } from "./staff-parked-purchases-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./staff-parked-purchases-actions", () => ({
  proposeRefundAction: vi.fn(),
  decideRefundAction: vi.fn(),
}));

const ME = "staff-me";
const OTHER = "staff-other";

const proposal = (proposedBy: string): NonNullable<ParkedPurchase["proposal"]> => ({
  id: "prop-1",
  kind: "refund_purchase",
  region: "AU",
  summary: "Refund",
  proposedBy,
  approvedBy: null,
  status: "pending",
  reason: "Rate rose",
  createdAt: "2026-10-20T10:00:00.000Z",
  decidedAt: null,
});

const row = (over: Partial<ParkedPurchase>): ParkedPurchase => ({
  purchaseId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
  businessId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b11",
  businessName: "Acme Pty Ltd",
  region: "AU",
  currency: "AUD",
  tierKey: "starter",
  points: 1_000 as Points,
  subtotalMinor: 4_500 as MinorUnits,
  taxMinor: 450 as MinorUnits,
  totalMinor: 4_950 as MinorUnits,
  status: "needs_review",
  reason: "The rate rose while the checkout was open.",
  paidAt: "2026-10-20T10:00:00.000Z",
  refundedAt: null,
  refundedBy: null,
  refundedByEmail: null,
  proposal: null,
  proposedByEmail: null,
  refundable: true,
  ...over,
});

function show(purchases: ParkedPurchase[], locale: "en-AU" | "id-ID" = "en-AU") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ staff: locale === "en-AU" ? enStaff : idStaff }}
    >
      <StaffParkedPurchasesScreen region="AU" purchases={purchases} currentStaffId={ME} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the parked purchases screen (5.1.g)", () => {
  it("says what refunding means and shows an empty state with nothing parked", () => {
    show([]);
    expect(
      screen.getByText(
        "The card is refunded in full, and the business buys again at today's price.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No parked purchases")).toBeInTheDocument();
  });

  it("shows the business, points, the total to refund and the reason", () => {
    show([row({})]);
    const table = screen.getAllByRole("table")[0]!;
    expect(within(table).getByText("Acme Pty Ltd")).toBeInTheDocument();
    expect(within(table).getByText("1,000")).toBeInTheDocument();
    expect(within(table).getByText("$49.50")).toBeInTheDocument();
    expect(
      within(table).getByText("The rate rose while the checkout was open."),
    ).toBeInTheDocument();
  });

  it("falls back to the business id when the name is gone", () => {
    show([row({ businessName: null })]);
    expect(screen.getAllByText("7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b11").length).toBeGreaterThan(0);
  });

  it("proposes a refund with the required reason and refreshes", async () => {
    vi.mocked(proposeRefundAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    show([row({})]);
    await user.click(screen.getAllByRole("button", { name: "Propose refund: Acme Pty Ltd" })[0]!);
    const submit = screen.getByRole("button", { name: "Propose refund" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), "Card charged, points refused");
    await user.click(submit);
    await waitFor(() =>
      expect(proposeRefundAction).toHaveBeenCalledWith(
        "AU",
        "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
        "Card charged, points refused",
      ),
    );
    expect(
      await screen.findByText("The refund was proposed and is waiting for a second staff member."),
    ).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server's own words when a proposal is refused and keeps the dialog open", async () => {
    vi.mocked(proposeRefundAction).mockResolvedValue({
      ok: false,
      message: "This purchase already has a refund waiting.",
    });
    const user = userEvent.setup();
    show([row({})]);
    await user.click(screen.getAllByRole("button", { name: "Propose refund: Acme Pty Ltd" })[0]!);
    await user.type(screen.getByLabelText(/Reason/), "x");
    await user.click(screen.getByRole("button", { name: "Propose refund" }));
    expect(
      await screen.findByText("This purchase already has a refund waiting."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers approve and reject on a proposal someone else made", async () => {
    vi.mocked(decideRefundAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    show([row({ proposal: proposal(OTHER), proposedByEmail: "ops.lee@yourtal.test" })]);
    expect(screen.getAllByText("Refund proposed by ops.lee@yourtal.test").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText(new RegExp(OTHER))).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Approve refund: Acme Pty Ltd" })[0]!);
    expect(decideRefundAction).toHaveBeenCalledWith("AU", "prop-1", "approve");
    expect(
      await screen.findByText("The refund was approved and the card is being refunded."),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Reject refund: Acme Pty Ltd" })[0]!);
    expect(decideRefundAction).toHaveBeenLastCalledWith("AU", "prop-1", "reject");
  });

  it("shows a 403 from approving as a message", async () => {
    vi.mocked(decideRefundAction).mockResolvedValue({
      ok: false,
      message: "You cannot approve your own proposal.",
    });
    const user = userEvent.setup();
    show([row({ proposal: proposal(OTHER) })]);
    await user.click(screen.getAllByRole("button", { name: "Approve refund: Acme Pty Ltd" })[0]!);
    expect(await screen.findByText("You cannot approve your own proposal.")).toBeInTheDocument();
  });

  it("offers no approve on a proposal the viewer made", () => {
    show([row({ proposal: proposal(ME) })]);
    expect(screen.queryByRole("button", { name: /Approve refund/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Propose refund/ })).not.toBeInTheDocument();
    expect(
      screen.getAllByText("Waiting for a second staff member to approve.").length,
    ).toBeGreaterThan(0);
  });

  it("says staff must check with the processor when there is no payment reference", () => {
    show([row({ refundable: false })]);
    expect(screen.queryByRole("button", { name: /Propose refund/ })).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        "There is no payment reference to refund through. Check with the processor.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("lists refunded rows with who refunded them, or the processor", () => {
    show([
      row({
        purchaseId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b20",
        status: "refunded",
        refundedAt: "2026-10-21T01:00:00.000Z",
        refundedBy: "staff-finance",
        refundedByEmail: "fin.kim@yourtal.test",
      }),
      row({
        purchaseId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b21",
        status: "refunded",
        refundedAt: "2026-10-21T02:00:00.000Z",
        refundedBy: null,
      }),
    ]);
    expect(screen.getByRole("heading", { name: "Refunded" })).toBeInTheDocument();
    expect(screen.getAllByText("Refunded").length).toBeGreaterThan(1);
    expect(screen.getAllByText(/by fin.kim@yourtal.test/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/at the processor/).length).toBeGreaterThan(0);
  });

  it("names a proposer with no email as a staff member, never an id", () => {
    show([row({ proposal: proposal(OTHER) })]);
    expect(screen.getAllByText("Refund proposed by a staff member").length).toBeGreaterThan(0);
  });

  it("writes dates in the region's zone and the app's language, so server and browser agree", () => {
    show([row({})]);
    // 10:00 UTC is 21:00 in Sydney in October.
    expect(screen.getAllByText(/^20 Oct 2026, 9:00/).length).toBeGreaterThan(0);
  });

  it("speaks Indonesian", () => {
    show([row({})], "id-ID");
    expect(
      screen.getAllByRole("button", { name: "Usulkan pengembalian dana: Acme Pty Ltd" }).length,
    ).toBeGreaterThan(0);
  });
});
