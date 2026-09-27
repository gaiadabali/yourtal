import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type {
  AccuracyBonusTooHighError,
  AllocationNotOwnedError,
  AllocationNotPartnerFundedError,
  AudienceMustBeAdultError,
  BusinessNotFoundError,
  CampaignNotDraftError,
  CampaignNotFoundError,
  IllegalTransitionError,
  LedgerRefusedError,
  NotKybVerifiedError,
  OpenViewingRequiresAllAgesError,
  PersistenceFailedError,
  PiiRequestError,
  PredictionRequestError,
  ProhibitedCategoryError,
  RewardExceedsCeilingError,
} from "./studio.errors";

const logger = new Logger("StudioErrorMapper");

/** The one adapter (docs/13b section 4) for this module's domain errors. */
export type StudioDomainError =
  | BusinessNotFoundError
  | CampaignNotFoundError
  | CampaignNotDraftError
  | ProhibitedCategoryError
  | AudienceMustBeAdultError
  | PiiRequestError
  | PredictionRequestError
  | AllocationNotOwnedError
  | AllocationNotPartnerFundedError
  | RewardExceedsCeilingError
  | AccuracyBonusTooHighError
  | LedgerRefusedError
  | NotKybVerifiedError
  | IllegalTransitionError
  | OpenViewingRequiresAllAgesError
  | PersistenceFailedError;

export function mapStudioErrorToHttpException(error: StudioDomainError): HttpException {
  switch (error.type) {
    case "business_not_found":
      return new NotFoundException({
        code: "business_not_found",
        message: `business ${error.businessId} was not found`,
      });
    case "campaign_not_found":
      return new NotFoundException({
        code: "campaign_not_found",
        message: `campaign ${error.campaignId} was not found`,
      });
    case "campaign_not_draft":
      return new BadRequestException({
        code: "campaign_not_draft",
        message: "this campaign has left draft; an advertiser edits freely only until submission",
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
    case "pii_request":
      return new BadRequestException({ code: "pii_request", message: error.reason });
    case "prediction_request":
      return new BadRequestException({ code: "prediction_request", message: error.reason });
    case "allocation_not_owned":
      return new BadRequestException({
        code: "allocation_not_owned",
        message: `allocation ${error.allocationId} does not belong to this business`,
      });
    case "allocation_not_partner_funded":
      return new BadRequestException({
        code: "allocation_not_partner_funded",
        message: `allocation ${error.allocationId} is not partner-funded`,
      });
    case "reward_exceeds_ceiling":
      return new BadRequestException({
        code: "reward_exceeds_ceiling",
        message: `base reward plus the maximum accuracy bonus exceeds the ${String(error.ceilingPoints)}-point ceiling for this campaign's duration (F14)`,
      });
    case "accuracy_bonus_too_high":
      return new BadRequestException({
        code: "accuracy_bonus_too_high",
        message: "the accuracy bonus cannot exceed 40% of the base reward",
      });
    case "open_viewing_requires_all_ages":
      return new BadRequestException({
        code: "open_viewing_requires_all_ages",
        message: "Open Viewing may only be enabled for an all_ages campaign (F8)",
      });
    case "not_kyb_verified":
      return new ForbiddenException({
        code: "not_kyb_verified",
        message:
          "this business's KYB has not been verified yet — submission is refused until it is",
      });
    case "illegal_transition":
      return new BadRequestException({ code: "illegal_transition", message: error.reason });
    case "ledger_refused":
      return new BadRequestException({ code: error.code, message: error.message });
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
