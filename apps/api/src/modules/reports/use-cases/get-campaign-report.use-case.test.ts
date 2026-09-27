import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { VoucherInternalClient } from "../../../shared/voucher-client/voucher-internal-client";
import type {
  CampaignReportRepository,
  QuestionAggregates,
  ReportedCampaign,
  SessionAggregates,
} from "../persistence/campaign-report.repository";
import { COHORT_FLOOR, TEEN_COHORT_FLOOR } from "../cohort-floor";
import { getCampaignReport } from "./get-campaign-report.use-case";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const BUSINESS_ID = "22222222-2222-4222-8222-222222222222";

function fakeRepo(overrides: {
  campaign?: ReportedCampaign | null;
  sessions?: SessionAggregates;
  questions?: QuestionAggregates | null;
}): CampaignReportRepository {
  return {
    findOwnedCampaign: () =>
      Promise.resolve(
        overrides.campaign === undefined
          ? { campaignId: CAMPAIGN_ID, audience: "all_ages" as const }
          : overrides.campaign,
      ),
    sessionAggregates: () =>
      Promise.resolve(
        overrides.sessions ?? { rewardedViews: 20, completions: 10, averageWatchTimeSeconds: 25 },
      ),
    questionAggregates: () =>
      Promise.resolve(
        overrides.questions === undefined
          ? { timesAsked: 40, timesCorrect: 30 }
          : overrides.questions,
      ),
  };
}

function fakeLedger(grantedPoints = 5_000): Pick<LedgerInternalClient, "campaignSpend"> {
  return {
    campaignSpend: () =>
      okAsync({
        campaignId: CAMPAIGN_ID,
        allocationId: "alloc-1",
        grantedPoints: toPoints(grantedPoints),
        completions: 10,
      }),
  };
}

function fakeVouchers(captureCount = 3): Pick<VoucherInternalClient, "merchantCaptureStats"> {
  return {
    merchantCaptureStats: () =>
      okAsync({
        merchantId: BUSINESS_ID,
        currency: "AUD" as const,
        captureCount,
        capturedMinor: toMinorUnits(0),
      }),
  };
}

describe("getCampaignReport", () => {
  it("assembles rates and the merchant sentence from every source, above the floor", async () => {
    const result = await getCampaignReport(
      fakeRepo({}),
      fakeLedger(5_000),
      fakeVouchers(3),
      BUSINESS_ID,
      CAMPAIGN_ID,
    );
    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    if (report.suppressed) throw new Error("expected an unsuppressed report");
    expect(report.rewardedViews).toBe(20);
    expect(report.completions).toBe(10);
    expect(report.completionRate).toBe(0.5);
    expect(report.averageWatchTimeSeconds).toBe(25);
    expect(report.questionAccuracy).toBe(0.75);
    expect(report.pointsSpent).toBe(5_000);
    expect(report.merchantVouchersRedeemed).toBe(3);
  });

  it("suppresses the whole report -- not just one number -- below the F12 cohort floor", async () => {
    const result = await getCampaignReport(
      fakeRepo({
        sessions: { rewardedViews: COHORT_FLOOR - 1, completions: 2, averageWatchTimeSeconds: 10 },
      }),
      fakeLedger(),
      fakeVouchers(),
      BUSINESS_ID,
      CAMPAIGN_ID,
    );
    expect(result.isOk()).toBe(true);
    const report = result._unsafeUnwrap();
    expect(report).toStrictEqual({
      campaignId: CAMPAIGN_ID,
      suppressed: true,
      floor: COHORT_FLOOR,
    });
  });

  it("uses the wider teen floor (20) for a teen-audience campaign", async () => {
    const result = await getCampaignReport(
      fakeRepo({
        campaign: { campaignId: CAMPAIGN_ID, audience: "teen" },
        sessions: { rewardedViews: 15, completions: 5, averageWatchTimeSeconds: 10 },
      }),
      fakeLedger(),
      fakeVouchers(),
      BUSINESS_ID,
      CAMPAIGN_ID,
    );
    const report = result._unsafeUnwrap();
    expect(report).toStrictEqual({
      campaignId: CAMPAIGN_ID,
      suppressed: true,
      floor: TEEN_COHORT_FLOOR,
    });
  });

  it("questionAccuracy is null when no question has been asked yet", async () => {
    const result = await getCampaignReport(
      fakeRepo({ questions: null }),
      fakeLedger(),
      fakeVouchers(),
      BUSINESS_ID,
      CAMPAIGN_ID,
    );
    const report = result._unsafeUnwrap();
    if (report.suppressed) throw new Error("expected an unsuppressed report");
    expect(report.questionAccuracy).toBeNull();
  });

  it("404s (campaign_not_found) for a campaign outside this business", async () => {
    const result = await getCampaignReport(
      fakeRepo({ campaign: null }),
      fakeLedger(),
      fakeVouchers(),
      BUSINESS_ID,
      CAMPAIGN_ID,
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({
      type: "campaign_not_found",
      campaignId: CAMPAIGN_ID,
    });
  });

  it("surfaces a ledger refusal as ledger_refused", async () => {
    const ledger: Pick<LedgerInternalClient, "campaignSpend"> = {
      campaignSpend: () => errAsync({ code: "region_mismatch", message: "wrong region" }),
    };
    const result = await getCampaignReport(
      fakeRepo({}),
      ledger,
      fakeVouchers(),
      BUSINESS_ID,
      CAMPAIGN_ID,
    );
    expect(result._unsafeUnwrapErr()).toStrictEqual({
      type: "ledger_refused",
      code: "region_mismatch",
      message: "wrong region",
    });
  });
});
