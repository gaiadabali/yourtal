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
  InvitationAlreadyOpenError,
  InvitationInvalidError,
  MemberNotFoundError,
  PersistenceFailedError,
  StorageRefNotUploadedError,
  TargetNotMemberError,
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
  | InvitationAlreadyOpenError
  | InvitationInvalidError
  | StorageRefNotUploadedError
  | TargetNotMemberError
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
    case "invitation_already_open":
      return new ConflictException({
        code: "invitation_already_open",
        message: `${error.email} already has an open invitation`,
      });
    case "target_not_member":
      return new BadRequestException({
        code: "target_not_member",
        message: `${error.userId} must already be a member before receiving ownership`,
      });
    case "storage_ref_not_uploaded":
      return new BadRequestException({
        code: "storage_ref_not_uploaded",
        message: "no object exists at this storageRef — request a fresh upload URL and try again",
      });
    case "invitation_invalid":
      // Never distinguishes "not found" from "expired" from "already
      // accepted" at the HTTP boundary -- same enumeration discipline as
      // auth's own token_invalid (request-password-reset.schema's sibling
      // confirm endpoints).
      return new BadRequestException({
        code: "invitation_invalid",
        message: "this invitation is invalid, expired, or already used",
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
