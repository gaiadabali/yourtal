import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type {
  BusinessNotFoundError,
  CannotChangeOwnerRoleError,
  CannotRemoveOwnerError,
  MemberAlreadyExistsError,
  MemberNotFoundError,
  PersistenceFailedError,
} from "./business.errors";

const logger = new Logger("BusinessErrorMapper");

/**
 * The one adapter (docs/13b section 4) for this module's domain errors —
 * every use-case's error union is a subset of this one, so one exhaustive
 * switch covers all of them. `AuthzError` (from `@yourtal/authz/decision`)
 * is a separate, platform-wide concern with its own mapper
 * (`shared/authz/authz-error.mapper.ts`) reused by every module, not just
 * this one; treating the two as one combined switch would tie a
 * cross-cutting authorization concern to this module's domain shape.
 */
export type BusinessDomainError =
  | BusinessNotFoundError
  | MemberAlreadyExistsError
  | MemberNotFoundError
  | CannotRemoveOwnerError
  | CannotChangeOwnerRoleError
  | PersistenceFailedError;

export function mapBusinessErrorToHttpException(error: BusinessDomainError): HttpException {
  switch (error.type) {
    case "business_not_found":
      return new NotFoundException({
        code: "business_not_found",
        message: `business ${error.businessId} was not found`,
      });
    case "member_already_exists":
      return new ConflictException({
        code: "member_already_exists",
        message: `${error.userId} is already a member`,
      });
    case "member_not_found":
      return new NotFoundException({
        code: "member_not_found",
        message: `${error.userId} is not a member of this business`,
      });
    case "cannot_remove_owner":
      return new BadRequestException({
        code: "cannot_remove_owner",
        message: "the owner cannot be removed directly; transfer ownership first",
      });
    case "cannot_change_owner_role":
      return new BadRequestException({
        code: "cannot_change_owner_role",
        message: "the owner's role cannot be changed directly; transfer ownership first",
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
