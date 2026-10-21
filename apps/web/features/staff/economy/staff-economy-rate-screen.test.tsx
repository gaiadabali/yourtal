import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { RateScreen } from "@yourtal/contracts/staff/economy";
import enStaff from "@/messages/en-AU/staff.json";
import idStaff from "@/messages/id-ID/staff.json";
import { StaffEconomyRateScreen } from "./staff-economy-rate-screen";

vi.mock("./staff-economy-actions", () => ({
  approveRateAction: vi.fn(),
  proposeRateAction: vi.fn(),
}));

const translator = (locale: "en-AU" | "id-ID") =>
  createTranslator({
    locale,
    messages: { staff: locale === "en-AU" ? enStaff : idStaff },
    namespace: "staff",
  } as never) as unknown as (key: string, values?: Record<string, string | number>) => string;

const rate = (email: string | null | undefined): RateScreen => ({
  region: "AU",
  currency: "AUD",
  currentBackingRateMicrosPerPoint: 31_000,
  pending: [
    {
      id: "p1",
      kind: "rate_change",
      region: "AU",
      summary: "Backing rate change",
      proposedBy: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
      ...(email === undefined ? {} : { proposedByEmail: email }),
      approvedBy: null,
      status: "pending",
      reason: null,
      createdAt: "2026-10-20T14:30:00.000Z",
      decidedAt: null,
    },
  ],
});

function show(value: RateScreen, locale: "en-AU" | "id-ID" = "en-AU") {
  return render(
    <StaffEconomyRateScreen
      t={translator(locale)}
      region="AU"
      rate={value}
      currentStaffId="me"
      idempotencyKey="k"
      flash={undefined}
    />,
  );
}

describe("the rate screen's proposals", () => {
  it("shows the proposer's email, not their user id", () => {
    show(rate("finance.one@example.test"));
    expect(screen.getAllByText("finance.one@example.test").length).toBeGreaterThan(0);
    expect(screen.queryByText("7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10")).not.toBeInTheDocument();
  });

  it("says a staff member when the API sent no email, never the id", () => {
    show(rate(null));
    expect(screen.getAllByText("A staff member").length).toBeGreaterThan(0);
    expect(screen.queryByText("7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10")).not.toBeInTheDocument();
  });

  it("falls back the same way when an older API omits the field, in Indonesian too", () => {
    show(rate(undefined), "id-ID");
    expect(screen.getAllByText("Seorang staf").length).toBeGreaterThan(0);
  });
});
