import { Controller, Get, Inject, Param } from "@nestjs/common";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { VOUCHER_INTERNAL_CLIENT } from "../../shared/voucher-client/voucher-internal-client";
import type { VoucherInternalClient } from "../../shared/voucher-client/voucher-internal-client";
import { CAMPAIGN_REPORT_REPOSITORY } from "./persistence/campaign-report.repository";
import type { CampaignReportRepository } from "./persistence/campaign-report.repository";
import { mapReportsErrorToHttpException } from "./to-http-exception";
import { getCampaignReport } from "./use-cases/get-campaign-report.use-case";

/**
 * 7.6: Studio reports. Reuses the pre-existing `report` resource kind and
 * policy (`policies/resource_policies/report.yaml`, already built) -- no
 * new Cerbos surface needed. `view` only; `export` (CSV/PDF) is not asked
 * for by 7.6's own spec.
 */
@Controller("api/:tenantId/studio/reports")
export class ReportsController {
  constructor(
    @Inject(CAMPAIGN_REPORT_REPOSITORY) private readonly reports: CampaignReportRepository,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(VOUCHER_INTERNAL_CLIENT) private readonly vouchers: VoucherInternalClient,
  ) {}

  @Authorize({ kind: "report", action: "view" })
  @NotValueMoving("A read.")
  @Get("campaigns/:campaignId")
  async campaignReport(
    @Param("tenantId") tenantId: string,
    @Param("campaignId") campaignId: string,
  ) {
    const result = await getCampaignReport(
      this.reports,
      this.ledger,
      this.vouchers,
      tenantId,
      campaignId,
    );
    if (result.isErr()) throw mapReportsErrorToHttpException(result.error);
    return result.value;
  }
}
