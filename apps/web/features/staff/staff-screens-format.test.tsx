import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { toMinorUnits, toPoints, type Points } from "@yourtal/contracts/money";
import type { StaffDispute } from "@yourtal/contracts/staff/disputes";
import type { StaffRiskFlag } from "@yourtal/contracts/staff/risk-queue";
import type { StaffVoucherBatchRequest } from "@yourtal/contracts/staff/moderation";
import type { StaffUserDetail } from "@yourtal/contracts/staff/users";
import type { Statement } from "@yourtal/contracts/ledger-internal/economy";
import enStaff from "@/messages/en-AU/staff.json";
import idStaff from "@/messages/id-ID/staff.json";
import { StaffDisputesList } from "./disputes/staff-disputes-list";
import { StaffVoucherBatchList } from "./moderation/staff-voucher-batch-list";
import { StaffRiskList } from "./risk/staff-risk-list";
import { StaffSettlementScreen } from "./settlement/staff-settlement-screen";
import { StaffUserDetailScreen } from "./users/staff-user-detail-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./disputes/staff-disputes-actions", () => ({ resolveDisputeAction: vi.fn() }));
vi.mock("./risk/staff-risk-actions", () => ({
  releaseRiskFlagAction: vi.fn(),
  suspendRiskFlagAction: vi.fn(),
}));
vi.mock("./moderation/staff-voucher-batch-actions", () => ({
  approveVoucherBatchAction: vi.fn(),
  rejectVoucherBatchAction: vi.fn(),
}));
vi.mock("./settlement/staff-settlement-actions", () => ({
  approvePayoutAction: vi.fn(),
  proposePayoutAction: vi.fn(),
  resolveStatementDisputeAction: vi.fn(),
  checkDisbursementAction: vi.fn(),
  decideRetryAction: vi.fn(),
  proposeRetryAction: vi.fn(),
}));
vi.mock("./users/staff-user-actions", () => ({
  goodwillAction: vi.fn(),
  releaseUserAction: vi.fn(),
  setTrustTierAction: vi.fn(),
  suspendUserAction: vi.fn(),
}));

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

function translator(locale: Locale) {
  return createTranslator({
    locale,
    messages: { staff: locale === "en-AU" ? enStaff : idStaff },
    namespace: "staff",
  } as never) as unknown as (key: string, values?: Record<string, string | number>) => string;
}

// 14:30 UTC on 20 Oct is 01:30 on the 21st in Sydney (UTC+11) and 21:30 on the 20th in Jakarta (UTC+7).
const AT = "2026-10-20T14:30:00.000Z";
const SYDNEY = "21 Oct 2026, 1:30 am";
const JAKARTA_ID = "20 Okt 2026, 21.30";
const USER_ID = "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10";

const dispute = (region: StaffDispute["region"]): StaffDispute => ({
  voucherId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b11",
  sagaId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b12",
  userId: USER_ID,
  region,
  reason: "not_honoured",
  createdAt: AT,
});

const flag = (region: StaffRiskFlag["region"]): StaffRiskFlag => ({
  id: "flag-1",
  userId: USER_ID,
  region,
  severity: "flag",
  reason: "velocity",
  signals: [],
  status: "pending",
  createdAt: AT,
});

describe("staff queues show dates in the row's region zone", () => {
  it("disputes: Sydney for an AU user, with the date and time", () => {
    intl(<StaffDisputesList disputes={[dispute("AU")]} />);
    expect(screen.getAllByText(SYDNEY).length).toBeGreaterThan(0);
  });

  it("disputes: Jakarta for an ID user, in the viewer's language", () => {
    intl(<StaffDisputesList disputes={[dispute("ID")]} />, "id-ID");
    expect(screen.getAllByText(JAKARTA_ID).length).toBeGreaterThan(0);
  });

  it("disputes: a user with no region reads in UTC and says so", () => {
    intl(<StaffDisputesList disputes={[dispute(null)]} />);
    expect(screen.getAllByText("20 Oct 2026, 2:30 pm UTC").length).toBeGreaterThan(0);
  });

  it("risk: the flag's own region decides the zone", () => {
    intl(<StaffRiskList initial={[flag("AU")]} />);
    expect(screen.getAllByText(SYDNEY).length).toBeGreaterThan(0);
  });

  it("voucher batches: a date-only column stays date-only (UTC, no region on a request)", () => {
    const request: StaffVoucherBatchRequest = {
      id: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b13",
      listingId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b14",
      merchantId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b15",
      quantity: 10,
      requestedBy: USER_ID,
      reason: null,
      state: "pending",
      approvedBy: null,
      decidedAt: null,
      mintedBatchId: null,
      createdAt: "2026-10-20T23:30:00.000Z",
    };
    intl(<StaffVoucherBatchList initial={[request]} />);
    expect(screen.getAllByText("20 Oct 2026").length).toBeGreaterThan(0);
  });
});

describe("the user detail ledger", () => {
  it("shows an entry's time in the user's region zone", () => {
    const user: StaffUserDetail = {
      userId: USER_ID,
      email: "someone@example.test",
      region: "ID",
      trustTier: 1,
      isSuspended: false,
      createdAt: AT,
      availablePoints: 10 as Points,
      pendingPoints: 0 as Points,
    } satisfies StaffUserDetail;
    intl(
      <StaffUserDetailScreen
        t={translator("id-ID")}
        session={{ roles: [] }}
        user={user}
        ledger={[
          {
            id: "h1",
            kind: "grant",
            points: 10 as Points,
            externalRef: "ref-1",
            campaignId: null,
            listingId: null,
            voucherId: null,
            at: AT,
          },
        ]}
        idempotencyKey="k"
        flash={undefined}
      />,
      "id-ID",
    );
    expect(screen.getAllByText(JAKARTA_ID).length).toBeGreaterThan(0);
  });
});

describe("the settlement queue", () => {
  const statement = (): Statement => ({
    id: "s1",
    businessId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b16",
    region: "AU",
    currency: "AUD",
    periodFrom: "2026-10-01T00:00:00.000Z",
    periodTo: "2026-10-08T00:00:00.000Z",
    openingPayableMinor: toMinorUnits(0),
    capturesMinor: toMinorUnits(0),
    refundsMinor: toMinorUnits(0),
    recoveriesMinor: toMinorUnits(0),
    closingPayableMinor: toMinorUnits(4_500),
    pointPurchasesMinor: toMinorUnits(0),
    pointPurchasesPoints: toPoints(0),
    status: "open",
    disputeReason: null,
    disputedAt: null,
    resolutionNote: null,
    resolvedAt: null,
    disputeWindowEndsAt: AT,
    generatedAt: "2026-10-08T00:00:00.000Z",
    approvedBy: null,
    approvedAt: null,
    payoutTransferId: null,
  });

  function show(locale: Locale) {
    return intl(
      <StaffSettlementScreen
        t={translator(locale)}
        region="AU"
        queue={{ region: "AU", statements: [statement()] }}
        payoutProposals={[]}
        disbursements={[]}
        canResolveDispute={false}
        canProposePayout={false}
        currentStaffId="me"
        idempotencyKey="k"
        flash={undefined}
      />,
      locale,
    );
  }

  it("shows the dispute window's end as a date in the region's zone, not the server's", () => {
    show("en-AU");
    expect(screen.getAllByText("21 Oct 2026").length).toBeGreaterThan(0);
  });

  it("formats the closing amount in the viewer's language, in the statement's currency", () => {
    show("id-ID");
    expect(screen.getAllByText("AU$45,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("21 Okt 2026").length).toBeGreaterThan(0);
  });
});
