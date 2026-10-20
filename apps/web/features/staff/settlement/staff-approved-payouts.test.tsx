import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import type { StaffDisbursement } from "@yourtal/contracts/billing/payouts";
import enAU from "@/messages/en-AU/staff.json";
import { disbursementLine } from "./staff-approved-payouts";

const t = createTranslator({
  locale: "en-AU",
  messages: { staff: enAU },
  namespace: "staff",
} as never) as unknown as (key: string, values?: Record<string, string | number>) => string;

const row = (over: Partial<StaffDisbursement>): StaffDisbursement => ({
  id: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
  statementId: "s1",
  proposalId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b11",
  businessId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b12",
  region: "AU",
  currency: "AUD",
  amountMinor: 1_000 as StaffDisbursement["amountMinor"],
  status: "queued",
  failureCode: null,
  attempt: 1,
  bankLast4: "3456",
  createdAt: "2026-10-10T00:00:00.000Z",
  transferredAt: null,
  paidAt: null,
  failedAt: null,
  checkedAt: null,
  needsStaff: false,
  retryProposal: null,
  ...over,
});

describe("disbursementLine (5.2)", () => {
  it.each([
    [undefined, "Queued"],
    [row({ status: "awaiting_account" }), "Waiting for the brand's payout details"],
    [row({ status: "transferred" }), "Sent to the brand's account"],
    [
      row({ status: "paid", paidAt: "2026-10-12T02:00:00.000Z" }),
      "Paid to bank ••3456 on 2026-10-12",
    ],
    [
      row({ status: "failed", failureCode: "account_closed", attempt: 2 }),
      "Failed (account_closed) (attempt 2)",
    ],
    [
      row({ status: "failed", failureCode: "payout_unconfirmed" }),
      "Failed: The processor did not confirm the payout within a day",
    ],
    [
      row({ status: "failed", failureCode: "transfer_declined", attempt: 2 }),
      "Failed: The processor declined the transfer (attempt 2)",
    ],
  ] as const)("%#", (disbursement, text) => {
    expect(disbursementLine(t, disbursement)).toBe(text);
  });
});
