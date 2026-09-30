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
  AudienceMustBeAdultError,
  BusinessNotFoundError,
  DecreaseAlreadyPendingError,
  InvalidLifecycleTransitionError,
  InvalidLocationsError,
  ListingNotFoundError,
  ListingPricingFailedError,
  LocationInUseError,
  LocationNotFoundError,
  NotAMaterialDecreaseError,
  PersistenceFailedError,
  ProhibitedCategoryError,
  SettlementDecreaseRequestNotFoundError,
  VoucherBatchRequestNotFoundError,
  VoucherMintFailedError,
} from "./store.errors";

const logger = new Logger("StoreErrorMapper");

/**
 * The one adapter (docs/13b section 4) for this module's domain errors,
 * mirroring `business/to-http-exception.ts`.
 */
export type StoreDomainError =
  | ListingNotFoundError
  | InvalidLocationsError
  | BusinessNotFoundError
  | InvalidLifecycleTransitionError
  | ProhibitedCategoryError
  | AudienceMustBeAdultError
  | NotAMaterialDecreaseError
  | DecreaseAlreadyPendingError
  | SettlementDecreaseRequestNotFoundError
  | ApprovalRefusedError
  | ListingPricingFailedError
  | LocationNotFoundError
  | LocationInUseError
  | VoucherBatchRequestNotFoundError
  | VoucherMintFailedError
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
    case "business_not_found":
      return new NotFoundException({
        code: "business_not_found",
        message: `business ${error.businessId} was not found`,
      });
    case "invalid_lifecycle_transition":
      return new BadRequestException({
        code: "invalid_lifecycle_transition",
        message: `cannot move a listing from ${error.from} to ${error.to}`,
      });
    case "prohibited_category":
      return new BadRequestException({
        code: "prohibited_category",
        message: `"${error.category}" is a prohibited content category in this business's region`,
      });
    case "audience_must_be_adult":
      return new BadRequestException({
        code: "audience_must_be_adult",
        message: `"${error.category}" is adult_only in this business's region; audience must be "adult"`,
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
    case "location_not_found":
      return new NotFoundException({
        code: "location_not_found",
        message: `location ${error.locationId} was not found`,
      });
    case "location_in_use":
      return new ConflictException({
        code: "location_in_use",
        message: `location ${error.locationId} is still offered by at least one listing`,
      });
    case "voucher_batch_request_not_found":
      return new NotFoundException({
        code: "voucher_batch_request_not_found",
        message: `voucher batch request ${error.requestId} was not found`,
      });
    case "voucher_mint_failed":
      logger.error(`voucher-internal refused the mint: ${error.code} -- ${error.message}`);
      return new ServiceUnavailableException({
        code: "voucher_mint_failed",
        message: "the voucher batch could not be minted",
      });
    case "listing_pricing_failed":
      logger.error(error.cause);
      return new ServiceUnavailableException({
        code: "listing_pricing_unavailable",
        message: "the listing's points price could not be computed",
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
