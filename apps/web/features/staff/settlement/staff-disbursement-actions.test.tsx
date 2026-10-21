import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffDisbursement } from "@yourtal/contracts/billing/payouts";
import type { MinorUnits } from "@yourtal/contracts/money";
import enStaff from "@/messages/en-AU/staff.json";
import { StaffDisbursementActions } from "./staff-disbursement-actions";
import {
  checkDisbursementAction,
  decideRetryAction,
  proposeRetryAction,
} from "./staff-settlement-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./staff-settlement-actions", () => ({
  checkDisbursementAction: vi.fn(),
  proposeRetryAction: vi.fn(),
  decideRetryAction: vi.fn(),
}));

const ME = "staff-me";
const LABEL = "Payout for statement s1";

const disbursement = (over: Partial<StaffDisbursement> = {}): StaffDisbursement => ({
  id: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
  statementId: "s1",
  proposalId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b11",
  businessId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b12",
  region: "AU",
  currency: "AUD",
  amountMinor: 1_000 as MinorUnits,
  status: "failed",
  failureCode: "payout_unconfirmed",
  attempt: 1,
  bankLast4: "3456",
  createdAt: "2026-10-10T00:00:00.000Z",
  transferredAt: "2026-10-10T01:00:00.000Z",
  paidAt: null,
  failedAt: "2026-10-11T01:00:00.000Z",
  checkedAt: null,
  needsStaff: true,
  retryProposal: null,
  ...over,
});

const pending = (proposedBy: string): NonNullable<StaffDisbursement["retryProposal"]> => ({
  id: "retry-1",
  kind: "retry_disbursement",
  region: "AU",
  summary: "Retry",
  proposedBy,
  approvedBy: null,
  status: "pending",
  reason: "Nothing moved",
  createdAt: "2026-10-12T00:00:00.000Z",
  decidedAt: null,
});

function show(d: StaffDisbursement) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ staff: enStaff }}>
      <StaffDisbursementActions
        region="AU"
        disbursement={d}
        payoutLabel={LABEL}
        currentStaffId={ME}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a stuck payout's actions (5.2.c)", () => {
  it("names the payout on every button and shows when it was last checked", () => {
    show(disbursement({ checkedAt: "2026-10-12T03:00:00.000Z" }));
    expect(screen.getByRole("button", { name: `Check again: ${LABEL}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Propose retry: ${LABEL}` })).toBeInTheDocument();
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
  });

  it.each([
    ["paid", "Paid. The processor shows the payout reached the bank."],
    ["pending", "Still on its way. The processor has not finished the payout yet."],
    ["transferred", "Transfer found. The payout goes out next."],
    ["nothing_found", "Nothing found at the processor. You can propose a retry."],
  ] as const)("a check that finds %s says so", async (outcome, text) => {
    vi.mocked(checkDisbursementAction).mockResolvedValue({ ok: true, outcome });
    show(disbursement());
    await userEvent.setup().click(screen.getByRole("button", { name: `Check again: ${LABEL}` }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(checkDisbursementAction).toHaveBeenCalledWith("AU", disbursement().id);
    expect(refresh).toHaveBeenCalled();
  });

  it("withdraws the retry offer once a check finds the payout alive", async () => {
    vi.mocked(checkDisbursementAction).mockResolvedValue({ ok: true, outcome: "pending" });
    show(disbursement());
    await userEvent.setup().click(screen.getByRole("button", { name: `Check again: ${LABEL}` }));
    await screen.findByText(/Still on its way/);
    expect(screen.queryByRole("button", { name: /Propose retry/ })).not.toBeInTheDocument();
  });

  it("proposes a retry with a required reason", async () => {
    vi.mocked(proposeRetryAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    show(disbursement());
    await user.click(screen.getByRole("button", { name: `Propose retry: ${LABEL}` }));
    const submit = screen.getByRole("button", { name: "Propose retry" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), "Nothing at the processor");
    await user.click(submit);
    expect(proposeRetryAction).toHaveBeenCalledWith(
      "AU",
      disbursement().id,
      "Nothing at the processor",
    );
    expect(
      await screen.findByText("The retry was proposed and is waiting for a second staff member."),
    ).toBeInTheDocument();
  });

  it("shows a refusal from the server", async () => {
    vi.mocked(checkDisbursementAction).mockResolvedValue({
      ok: false,
      message: "The processor is not available right now.",
    });
    show(disbursement());
    await userEvent.setup().click(screen.getByRole("button", { name: `Check again: ${LABEL}` }));
    expect(
      await screen.findByText("The processor is not available right now."),
    ).toBeInTheDocument();
  });

  it("names the proposer of a retry by email, and as a staff member when there is none, never by id", () => {
    const { unmount } = show(
      disbursement({
        retryProposal: { ...pending("staff-other"), proposedByEmail: "finance.one@example.test" },
      }),
    );
    expect(screen.getByText("Retry proposed by finance.one@example.test")).toBeInTheDocument();
    unmount();

    show(disbursement({ retryProposal: pending("staff-other") }));
    expect(screen.getByText("Retry proposed by a staff member")).toBeInTheDocument();
    expect(screen.queryByText(/staff-other/)).not.toBeInTheDocument();
  });

  it("writes the last check in the region's zone", () => {
    // 03:00 UTC on 12 Oct is 14:00 in Sydney (UTC+11).
    show(disbursement({ checkedAt: "2026-10-12T03:00:00.000Z" }));
    expect(screen.getByText("Last checked 12 Oct 2026, 2:00 pm")).toBeInTheDocument();
  });

  it("offers approve and reject on someone else's retry, and neither on my own", async () => {
    vi.mocked(decideRetryAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { unmount } = show(disbursement({ retryProposal: pending("staff-other") }));
    expect(screen.queryByRole("button", { name: /Propose retry/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `Approve retry: ${LABEL}` }));
    expect(decideRetryAction).toHaveBeenCalledWith("AU", "retry-1", "approve");
    await user.click(screen.getByRole("button", { name: `Reject retry: ${LABEL}` }));
    expect(decideRetryAction).toHaveBeenLastCalledWith("AU", "retry-1", "reject");
    unmount();

    show(disbursement({ retryProposal: pending(ME) }));
    expect(screen.queryByRole("button", { name: /Approve retry/ })).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for a second staff member to approve.")).toBeInTheDocument();
  });
});
