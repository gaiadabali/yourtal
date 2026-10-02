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
  CampaignNotPendingReviewError,
  IllegalTransitionError,
  LedgerRefusedError,
  NotKybVerifiedError,
  CreativeBlockedError,
  OpenViewingRequiresAllAgesError,
  QuickTooLongError,
  PersistenceFailedError,
  PiiRequestError,
  PredictionRequestError,
  ProhibitedCategoryError,
  QuestionNotFoundError,
  QuestionTypeImmutableError,
  RewardExceedsCeilingError,
  TeenPersonalQuestionError,
} from "./studio.errors";

const logger = new Logger("StudioErrorMapper");

/** The one adapter (docs/13b section 4) for this module's domain errors. */
export type StudioDomainError =
  | BusinessNotFoundError
  | CampaignNotFoundError
  | CampaignNotDraftError
  | CampaignNotPendingReviewError
  | ProhibitedCategoryError
  | AudienceMustBeAdultError
  | PiiRequestError
  | PredictionRequestError
  | TeenPersonalQuestionError
  | QuestionNotFoundError
  | QuestionTypeImmutableError
  | AllocationNotOwnedError
  | AllocationNotPartnerFundedError
  | RewardExceedsCeilingError
  | AccuracyBonusTooHighError
  | LedgerRefusedError
  | NotKybVerifiedError
  | CreativeBlockedError
  | IllegalTransitionError
  | OpenViewingRequiresAllAgesError
  | QuickTooLongError
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
    case "campaign_not_pending_review":
      return new BadRequestException({
        code: "campaign_not_pending_review",
        message: `this campaign is "${error.state}", not "in_review" -- there is nothing for a moderator to decide`,
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
    case "teen_personal_question":
      return new BadRequestException({
        code: "teen_personal_question",
        message: error.reason,
      });
    case "question_not_found":
      return new NotFoundException({
        code: "question_not_found",
        message: `no question ${error.questionId} was found for this campaign`,
      });
    case "question_type_immutable":
      return new BadRequestException({
        code: "question_type_immutable",
        message:
          "a question's type cannot change on edit -- retire it and author a new one instead",
      });
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
    case "quick_too_long":
      return new BadRequestException({
        code: "quick_too_long",
        message: "A Short must be 60 seconds or less.",
      });
    case "not_kyb_verified":
      return new ForbiddenException({
        code: "not_kyb_verified",
        message:
          "this business's KYB has not been verified yet — submission is refused until it is",
      });
    case "creative_blocked":
      return new BadRequestException({
        code: "creative_blocked",
        message: "The title or synopsis breaks the content rules. Change it and submit again.",
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
