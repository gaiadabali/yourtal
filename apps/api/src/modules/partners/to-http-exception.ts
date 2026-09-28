import {
  BadRequestException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { PartnerActionError } from "./partners.errors";

const logger = new Logger("PartnersErrorMapper");

export type PartnersError = PartnerActionError | LedgerError;

export function mapPartnersErrorToHttpException(error: PartnersError): HttpException {
  if ("code" in error) {
    return new ConflictException({ code: error.code, message: error.message });
  }
  switch (error.type) {
    case "invalid_link_code":
      return new BadRequestException({
        code: "invalid_link_code",
        message: "this link code is unknown or expired",
      });
    case "duplicate_receipt":
      return new ConflictException({
        code: "duplicate_receipt",
        message: "this receipt has already been scanned",
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
