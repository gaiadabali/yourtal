import { Controller, Get, Inject, NotFoundException, Param } from "@nestjs/common";
import type { VoucherStatusReport } from "@yourtal/contracts/report/voucher-status-report";
import type { AppDb } from "../../shared/persistence/drizzle-client";
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
import { getVoucherStatusReport } from "./use-cases/get-voucher-status-report.use-case";
import { REPORTS_DB } from "./reports.tokens";

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
    @Inject(REPORTS_DB) private readonly db: AppDb,
  ) {}

  /** 13.10: the business's own vouchers by status, cohort-floored. */
  @Authorize({ kind: "report", action: "view" })
  @NotValueMoving("A read.")
  @Get("vouchers")
  async voucherStatus(@Param("tenantId") tenantId: string): Promise<VoucherStatusReport> {
    const report = await getVoucherStatusReport(this.db, this.vouchers, tenantId);
    if (report === null)
      throw new NotFoundException({ code: "not_found", message: "No such business." });
    return report;
  }

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
