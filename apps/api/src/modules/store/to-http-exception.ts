import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type {
  InvalidLifecycleTransitionError,
  InvalidLocationsError,
  ListingNotFoundError,
  PersistenceFailedError,
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
