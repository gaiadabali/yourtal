import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { toPoints } from "@yourtal/contracts/money";
import type { CampaignReportResult } from "@yourtal/contracts/report";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { VoucherInternalClient } from "../../../shared/voucher-client/voucher-internal-client";
import type { CampaignReportRepository } from "../persistence/campaign-report.repository";
import type { GetCampaignReportError } from "../reports.errors";
import { COHORT_FLOOR, TEEN_COHORT_FLOOR } from "../cohort-floor";
import { wrapPersistence } from "../wrap-reports";

/**
 * 7.6.a: one campaign's own report, aggregates only. Below the F12 cohort
 * floor, EVERY number is withheld together -- they share one denominator
 * (the same session population), so showing completions while hiding views
 * would just let the floor be worked around by division.
 */
export function getCampaignReport(
  repo: CampaignReportRepository,
  ledger: Pick<LedgerInternalClient, "campaignSpend">,
  vouchers: Pick<VoucherInternalClient, "merchantCaptureStats">,
  businessId: string,
  campaignId: string,
): ResultAsync<CampaignReportResult, GetCampaignReportError> {
  return wrapPersistence(repo.findOwnedCampaign(businessId, campaignId)).andThen((campaign) => {
    if (campaign === null) {
      return errAsync<CampaignReportResult, GetCampaignReportError>({
        type: "campaign_not_found",
        campaignId,
      });
    }

    const floor = campaign.audience === "teen" ? TEEN_COHORT_FLOOR : COHORT_FLOOR;

    return wrapPersistence(repo.sessionAggregates(campaignId)).andThen((sessions) => {
      if (sessions.rewardedViews < floor) {
        return okAsync<CampaignReportResult, GetCampaignReportError>({
          campaignId,
          suppressed: true,
          floor,
        });
      }

      return wrapPersistence(repo.questionAggregates(campaignId)).andThen((questions) =>
        ledger
          .campaignSpend(campaignId)
          .mapErr(
            (error): GetCampaignReportError => ({
              type: "ledger_refused",
              code: error.code,
              message: error.message,
            }),
          )
          .andThen((spend) => {
            const today = new Date().toISOString().slice(0, 10);
            return vouchers
              .merchantCaptureStats({ merchantId: businessId, from: "2000-01-01", to: today })
              .mapErr(
                (error): GetCampaignReportError => ({
                  type: "voucher_refused",
                  code: error.code,
                  message: error.message,
                }),
              )
              .map(
                (captureStats): CampaignReportResult => ({
                  campaignId,
                  suppressed: false,
                  rewardedViews: sessions.rewardedViews,
                  completions: sessions.completions,
                  completionRate: sessions.completions / sessions.rewardedViews,
                  averageWatchTimeSeconds: sessions.averageWatchTimeSeconds,
                  questionAccuracy:
                    questions === null ? null : questions.timesCorrect / questions.timesAsked,
                  pointsSpent: toPoints(spend.grantedPoints),
                  merchantVouchersRedeemed: captureStats.captureCount,
                }),
              );
          }),
      );
    });
  });
}
