import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CardPurchase } from "@yourtal/contracts/billing";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { CardReturnNotice, PurchaseReturnNotice } from "./billing-return-notices";
import { BillingCardPanel } from "./billing-card-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./purchase-points-action", () => ({ startCardSetupAction: vi.fn() }));

const purchase = (status: CardPurchase["status"]): CardPurchase => ({
  purchaseId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
  status,
  tierKey: "starter",
  points: toPoints(1_000),
  subtotalMinor: toMinorUnits(4_500),
  taxMinor: toMinorUnits(450),
  totalMinor: toMinorUnits(4_950),
  taxRateBps: 1_000,
  currency: "AUD",
  allocationId: status === "paid" ? "alloc_1" : null,
  createdAt: "2026-10-20T10:00:00.000Z",
  paidAt: null,
});

describe("the Billing page after the checkout (5.1.a)", () => {
  it.each([
    ["paid", false, "Points bought. They are ready to fund your campaigns."],
    ["pending", false, "Waiting for the payment to confirm"],
    ["pending", true, "Payment cancelled. Nothing was charged."],
    ["expired", false, "This payment expired before it was completed. Nothing was charged."],
    [
      "refunded",
      false,
      "This payment was refunded to your card in full. You can buy again at today's price.",
    ],
    [
      "needs_review",
      false,
      "We received your payment and are checking it. Your points will be added shortly.",
    ],
  ] as const)("a %s purchase (cancelled: %s) says so", (status, cancelled, text) => {
    render(
      <PurchaseReturnNotice purchase={purchase(status)} cancelled={cancelled} locale="en-AU" />,
    );
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("speaks Indonesian for an Indonesian business", () => {
    render(
      <PurchaseReturnNotice purchase={purchase("pending")} cancelled={false} locale="id-ID" />,
    );
    expect(screen.getByText("Menunggu konfirmasi pembayaran")).toBeInTheDocument();
  });

  it("waits for a card still on its way from the webhook, then confirms it", () => {
    const { rerender } = render(
      <CardReturnNotice outcome="saved" card={{ card: null, required: true }} locale="en-AU" />,
    );
    expect(
      screen.getByText("Saving your card. This usually takes a few seconds."),
    ).toBeInTheDocument();
    rerender(
      <CardReturnNotice
        outcome="saved"
        card={{
          card: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2031 },
          required: true,
        }}
        locale="en-AU"
      />,
    );
    expect(screen.getByText("Card saved. Boosts will be charged to it.")).toBeInTheDocument();
  });
});

describe("BillingCardPanel", () => {
  it("shows only brand, last four and expiry, and offers to replace it", () => {
    render(
      <BillingCardPanel
        businessId="b1"
        card={{
          card: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2031 },
          required: true,
        }}
        canEdit
        locale="en-AU"
      />,
    );
    expect(screen.getByText("Visa ending in 4242, expires 04/31")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace card" })).toBeInTheDocument();
  });

  it("is not shown where boosts need no saved card", () => {
    const { container } = render(
      <BillingCardPanel
        businessId="b1"
        card={{ card: null, required: false }}
        canEdit
        locale="id-ID"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
