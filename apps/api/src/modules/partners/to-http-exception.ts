import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { PartnerActionError } from "./partners.errors";

const logger = new Logger("PartnersErrorMapper");

/**
 * `linkId` is set once a call has a link (14.3.b): a first call that spends
 * the code and then fails on the receipt still tells the partner which link
 * to send next time, since the code cannot be used again.
 */
export type PartnersError = (PartnerActionError | LedgerError) & { readonly linkId?: string };

function body(code: string, message: string, linkId: string | undefined) {
  return linkId === undefined ? { code, message } : { code, message, linkId };
}

export function mapPartnersErrorToHttpException(error: PartnersError): HttpException {
  const { linkId } = error;
  if ("code" in error) {
    return new ConflictException(body(error.code, error.message, linkId));
  }
  switch (error.type) {
    case "invalid_link_code":
      return new BadRequestException(
        body("invalid_link_code", "this link code is unknown, expired or already used", linkId),
      );
    case "unknown_link":
      return new BadRequestException(
        body("unknown_link", "no link with this id exists for this partner", linkId),
      );
    case "link_revoked":
      return new ForbiddenException(
        body("link_revoked", "the user unlinked this app; ask them to link again", linkId),
      );
    case "teen_not_allowed":
      return new ForbiddenException(
        body("teen_consent_not_allowed", "a teen account can't link a partner app", linkId),
      );
    case "identity_check_required":
      return new ForbiddenException(
        body(
          "identity_check_required",
          "the user must verify their email and add a passkey in YourTal before they can earn points",
          linkId,
        ),
      );
    case "persistence_failed":
      logger.error(error.cause);
      return new ServiceUnavailableException(
        body("persistence_unavailable", "the request could not be completed", linkId),
      );
    default: {
      const unreachable: never = error;
      return new ServiceUnavailableException({
        code: "unknown_error",
        message: String(unreachable),
      });
    }
  }
}
