import { describe, expect, it } from "vitest";
import type { LedgerHistoryEntry } from "@yourtal/contracts/ledger-internal/wallet";
import type { WalletVoucherRow } from "@yourtal/contracts/voucher-internal/wallet";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { buildDataExportSections } from "./data-export";
import type { ExportAccountRow, ExportWatchSessionRow } from "./persistence/data-export.reader";

const NOW = new Date("2026-10-08T00:00:00Z");
const VOUCHER_ID = "11111111-1111-4111-8111-111111111111";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

const account: ExportAccountRow = {
  email: "viewer@example.com",
  displayName: "Viewer",
  region: "AU",
  displayLocale: "en-AU",
  timezone: "Australia/Sydney",
  dateOfBirth: "2012-01-01",
  parentConsentStatus: "granted",
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

const history: LedgerHistoryEntry[] = [
  {
    id: "h2",
    kind: "burn",
    points: toPoints(500),
    externalRef: "saga-secret",
    campaignId: null,
    listingId: LISTING_ID,
    voucherId: VOUCHER_ID,
    at: "2026-10-02T00:00:00.000Z",
  },
  {
    id: "h1",
    kind: "grant",
    points: toPoints(120),
    externalRef: `watch-grant:${SESSION_ID}`,
    campaignId: CAMPAIGN_ID,
    listingId: null,
    voucherId: null,
    at: "2026-10-01T00:00:00.000Z",
  },
];

const voucher: WalletVoucherRow = {
  voucherId: VOUCHER_ID,
  listingId: LISTING_ID,
  sagaId: "saga-secret",
  state: "activated",
  lifecycleState: "active",
  voidReason: null,
  merchantName: "Cafe Bali",
  title: "Free coffee",
  currency: "AUD",
  faceValueMinor: toMinorUnits(500),
  remainingValueMinor: toMinorUnits(500),
  partialRedemptionPolicy: "single_use_forfeit",
  expiresAt: "2027-10-01T00:00:00.000Z",
  location: null,
};

const sessions: ExportWatchSessionRow[] = [
  {
    sessionId: SESSION_ID,
    campaignId: CAMPAIGN_ID,
    campaignTitle: "Spring launch",
    state: "completed",
    startedAt: new Date("2026-10-01T00:00:00Z"),
    completedAt: new Date("2026-10-01T00:01:00Z"),
    rewarded: true,
  },
];

describe("buildDataExportSections", () => {
  const out = buildDataExportSections({
    now: NOW,
    account,
    history,
    vouchers: [voucher],
    sessions,
  });

  it("holds the account with its age band", () => {
    expect(out.account).toMatchObject({
      email: "viewer@example.com",
      region: "AU",
      locale: "en-AU",
      ageBand: "teen",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("holds wallet entries with kind, points and date", () => {
    expect(out.wallet.map((e) => [e.kind, e.points, e.at])).toEqual([
      ["burn", 500, "2026-10-02T00:00:00.000Z"],
      ["earn", 120, "2026-10-01T00:00:00.000Z"],
    ]);
  });

  it("holds vouchers with the burn date as issued, and no code or saga", () => {
    expect(out.vouchers).toEqual([
      expect.objectContaining({
        title: "Free coffee",
        brand: "Cafe Bali",
        status: "active",
        issuedAt: "2026-10-02T00:00:00.000Z",
        expiresAt: "2027-10-01T00:00:00.000Z",
      }),
    ]);
  });

  it("ties a watch session to the points its grant paid", () => {
    expect(out.watchSessions[0]).toMatchObject({
      campaignTitle: "Spring launch",
      state: "completed",
      pointsEarned: 120,
    });
  });

  it("leaks no internal field", () => {
    const text = JSON.stringify(out);
    for (const secret of ["saga-secret", "externalRef", "sagaId", "watch-grant", '"code"']) {
      expect(text).not.toContain(secret);
    }
  });

  it("copes with an account row that is gone", () => {
    const empty = buildDataExportSections({
      now: NOW,
      account: null,
      history: [],
      vouchers: [],
      sessions: [],
    });
    expect(empty.account).toBeNull();
  });
});
