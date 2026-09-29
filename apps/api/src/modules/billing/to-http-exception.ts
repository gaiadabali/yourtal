import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  BusinessNotFoundError,
  CampaignSpendNotOwnedError,
  CurrencyMismatchError,
  LedgerRefusedError,
  PaymentDeclinedError,
  PersistenceFailedError,
} from "./billing.errors";

const logger = new Logger("BillingErrorMapper");

export type BillingDomainError =
  | BusinessNotFoundError
  | CurrencyMismatchError
  | LedgerRefusedError
  | PaymentDeclinedError
  | CampaignSpendNotOwnedError
  | PersistenceFailedError;

export function mapBillingErrorToHttpException(error: BillingDomainError): HttpException {
  switch (error.type) {
    case "business_not_found":
      return new NotFoundException({
        code: "business_not_found",
        message: `business ${error.businessId} was not found`,
      });
    case "currency_mismatch":
      return new BadRequestException({
        code: "currency_mismatch",
        message: `this business is billed in ${error.expected}, not ${error.stated}`,
      });
    case "payment_declined":
      return new HttpException(
        { code: "payment_declined", message: error.detail },
        HttpStatus.PAYMENT_REQUIRED,
      );
    case "ledger_refused":
      // 10.1.c/10.6.c: a state conflict (the F12 dispute window is still
      // open, or the statement is not `open` any more), not a malformed
      // request -- the same 409 services/ledger itself answers with.
      if (error.code === "dispute_window_open" || error.code === "statement_not_open") {
        return new ConflictException({ code: error.code, message: error.message });
      }
      return new BadRequestException({ code: error.code, message: error.message });
    // 404, not 403: a campaign whose spend belongs to another business
    // should look exactly like one that does not exist -- same reasoning
    // `StoreListingController`'s lifecycle routes already follow.
    case "campaign_spend_not_owned":
      return new NotFoundException({
        code: "campaign_not_found",
        message: `no campaign ${error.campaignId} was found for this business`,
      });
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
