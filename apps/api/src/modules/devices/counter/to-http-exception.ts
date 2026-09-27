import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type { LedgerErrorCode } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { PersistenceFailedError } from "../devices.errors";

const logger = new Logger("CounterErrorMapper");

export type CounterDomainError =
  | { readonly code: LedgerErrorCode; readonly message: string }
  | PersistenceFailedError;

/** `VoucherError` is the closed `LedgerError` enum (1.2.c) — one mapper for both this module's error sources. */
export function mapCounterErrorToHttpException(error: CounterDomainError): HttpException {
  if ("type" in error) {
    logger.error(error.cause);
    return new ServiceUnavailableException({
      code: "persistence_unavailable",
      message: "the request could not be completed",
    });
  }
  switch (error.code) {
    case "audience_blocked":
      return new NotFoundException({ code: error.code, message: error.message });
    case "already_granted":
      return new ConflictException({ code: error.code, message: error.message });
    case "kill_switch":
      return new ForbiddenException({ code: error.code, message: error.message });
    default:
      return new ConflictException({ code: error.code, message: error.message });
  }
}
