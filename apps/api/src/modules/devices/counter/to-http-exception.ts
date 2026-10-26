import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type { LedgerErrorCode } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { PersistenceFailedError } from "../devices.errors";
import type { AmountRefusedError } from "./use-cases/authorize-voucher.use-case";

const logger = new Logger("CounterErrorMapper");

export type CounterDomainError =
  | { readonly code: LedgerErrorCode; readonly message: string }
  | PersistenceFailedError
  | AmountRefusedError;

/** `VoucherError` is the closed `LedgerError` enum (1.2.c) — one mapper for both this module's error sources. */
export function mapCounterErrorToHttpException(error: CounterDomainError): HttpException {
  if ("type" in error && error.type === "amount_refused") {
    // The screen reads `code` for its copy and `remainingValueMinor` for the figure it quotes.
    return new UnprocessableEntityException({
      code: error.code,
      message: "this amount cannot be redeemed against this voucher",
      remainingValueMinor: error.remainingValueMinor,
    });
  }
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
