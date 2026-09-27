import {
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type { VoucherError } from "../../../shared/voucher-client/voucher-internal-client";
import type { DevelopersDomainError } from "./developers.errors";

const logger = new Logger("DevelopersErrorMapper");

export type DevelopersError = DevelopersDomainError | VoucherError;

export function mapDevelopersErrorToHttpException(error: DevelopersError): HttpException {
  if ("code" in error) {
    return new ForbiddenException({ code: error.code, message: error.message });
  }
  switch (error.type) {
    case "credential_not_found":
      return new NotFoundException({
        code: "credential_not_found",
        message: `no credential ${error.credentialId}`,
      });
    case "credential_not_owned":
      return new ForbiddenException({
        code: "credential_not_owned",
        message: `credential ${error.credentialId} does not belong to this business`,
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
