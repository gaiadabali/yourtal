import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type {
  ApprovalRefusedError,
  DecreaseAlreadyPendingError,
  InvalidLifecycleTransitionError,
  InvalidLocationsError,
  ListingNotFoundError,
  NotAMaterialDecreaseError,
  PersistenceFailedError,
  SettlementDecreaseRequestNotFoundError,
} from "./store.errors";

const logger = new Logger("StoreErrorMapper");

/**
 * The one adapter (docs/13b section 4) for this module's domain errors,
 * mirroring `business/to-http-exception.ts`.
 */
export type StoreDomainError =
  | ListingNotFoundError
  | InvalidLocationsError
  | InvalidLifecycleTransitionError
  | NotAMaterialDecreaseError
  | DecreaseAlreadyPendingError
  | SettlementDecreaseRequestNotFoundError
  | ApprovalRefusedError
  | PersistenceFailedError;

export function mapStoreErrorToHttpException(error: StoreDomainError): HttpException {
  switch (error.type) {
    case "listing_not_found":
      return new NotFoundException({
        code: "listing_not_found",
        message: `listing ${error.listingId} was not found`,
      });
    case "invalid_locations":
      return new BadRequestException({
        code: "invalid_locations",
        message: `one or more locations do not belong to this business: ${error.locationIds.join(", ")}`,
      });
    case "invalid_lifecycle_transition":
      return new BadRequestException({
        code: "invalid_lifecycle_transition",
        message: `cannot move a listing from ${error.from} to ${error.to}`,
      });
    case "not_a_material_decrease":
      return new BadRequestException({
        code: "not_a_material_decrease",
        message: `the proposed change to listing ${error.listingId} is not a material decrease -- use set_settlement_value directly`,
      });
    case "decrease_already_pending":
      return new ConflictException({
        code: "decrease_already_pending",
        message: `listing ${error.listingId} already has a settlement decrease awaiting approval`,
      });
    case "settlement_decrease_request_not_found":
      return new NotFoundException({
        code: "settlement_decrease_request_not_found",
        message: `settlement decrease request ${error.requestId} was not found`,
      });
    case "approval_refused":
      // Deliberately one status for two causes (docs/13c, mirroring
      // services/voucher's Minter.Approve): the request was already
      // resolved, or this principal raised it themselves. Both refuse the
      // same way and neither is this caller's to distinguish from the
      // response alone.
      return new ForbiddenException({
        code: "approval_refused",
        message: `settlement decrease request ${error.requestId} could not be approved -- it may already be resolved, or you may be the person who requested it`,
      });
    case "persistence_failed":
      logger.error(error.cause);
      return new ServiceUnavailableException({
        code: "persistence_unavailable",
        message: "the request could not be completed",
      });
    default: {
      // docs/13b section 4: a `never` default so a new error variant fails
      // this file to compile rather than falling through silently.
      const unreachable: never = error;
      return new ServiceUnavailableException({
        code: "unknown_error",
        message: String(unreachable),
      });
    }
  }
}
