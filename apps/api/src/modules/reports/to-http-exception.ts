import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type { GetCampaignReportError } from "./reports.errors";

const logger = new Logger("ReportsErrorMapper");

export function mapReportsErrorToHttpException(error: GetCampaignReportError): HttpException {
  switch (error.type) {
    case "campaign_not_found":
      return new NotFoundException({
        code: "campaign_not_found",
        message: `no campaign ${error.campaignId} was found for this business`,
      });
    case "ledger_refused":
      return new BadRequestException({ code: error.code, message: error.message });
    case "voucher_refused":
      return new BadRequestException({ code: error.code, message: error.message });
    case "persistence_failed":
      logger.error(error.cause);
      return new ServiceUnavailableException({
        code: "persistence_unavailable",
        message: "the request could not be completed",
      });
    default: {
      const unreachable: never = error;
      return new ServiceUnavailableException({
        code: "unknown_error",
        message: String(unreachable),
      });
    }
  }
}
