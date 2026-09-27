/** Discriminated unions on `type` for every expected failure Studio's use-cases can produce (docs/13b section 4). */

export interface BusinessNotFoundError {
  readonly type: "business_not_found";
  readonly businessId: string;
}

export interface CampaignNotFoundError {
  readonly type: "campaign_not_found";
  readonly campaignId: string;
}

export interface PersistenceFailedError {
  readonly type: "persistence_failed";
  readonly cause: string;
}

/** A prohibited category for the business's own region (1.1.d, red line-adjacent). */
export interface ProhibitedCategoryError {
  readonly type: "prohibited_category";
  readonly category: string;
}

/** An adult_only category was saved with an audience other than "adult". */
export interface AudienceMustBeAdultError {
  readonly type: "audience_must_be_adult";
  readonly category: string;
}

/** Draft CRUD is refused once the campaign has left `draft` (docs/17: "an advertiser edits freely until they submit"). */
export interface CampaignNotDraftError {
  readonly type: "campaign_not_draft";
}

/** F8: Open Viewing may only be turned on for an all_ages campaign. */
export interface OpenViewingRequiresAllAgesError {
  readonly type: "open_viewing_requires_all_ages";
}

export type CreateCampaignDraftError =
  | BusinessNotFoundError
  | ProhibitedCategoryError
  | AudienceMustBeAdultError
  | OpenViewingRequiresAllAgesError
  | PersistenceFailedError;

export type UpdateCampaignDraftError =
  | CampaignNotFoundError
  | CampaignNotDraftError
  | ProhibitedCategoryError
  | AudienceMustBeAdultError
  | OpenViewingRequiresAllAgesError
  | PersistenceFailedError;

export interface PiiRequestError {
  readonly type: "pii_request";
  readonly category: string;
  readonly reason: string;
}

export interface PredictionRequestError {
  readonly type: "prediction_request";
  readonly reason: string;
}

export type CreateQuestionError =
  CampaignNotFoundError | PiiRequestError | PredictionRequestError | PersistenceFailedError;

export interface LedgerRefusedError {
  readonly type: "ledger_refused";
  readonly code: string;
  readonly message: string;
}

export interface AllocationNotOwnedError {
  readonly type: "allocation_not_owned";
  readonly allocationId: string;
}

export interface AllocationNotPartnerFundedError {
  readonly type: "allocation_not_partner_funded";
  readonly allocationId: string;
}

/** F14: base + max accuracy bonus exceeds the region's reward_ceiling_points_per_minute, scaled to the campaign's duration. */
export interface RewardExceedsCeilingError {
  readonly type: "reward_exceeds_ceiling";
  readonly ceilingPoints: number;
}

/** 7.3.c: the accuracy bonus exceeds 40% of the base reward. */
export interface AccuracyBonusTooHighError {
  readonly type: "accuracy_bonus_too_high";
}

export type SetRewardConfigError =
  | CampaignNotFoundError
  | CampaignNotDraftError
  | AllocationNotOwnedError
  | AllocationNotPartnerFundedError
  | RewardExceedsCeilingError
  | AccuracyBonusTooHighError
  | LedgerRefusedError
  | PersistenceFailedError;

export interface NotKybVerifiedError {
  readonly type: "not_kyb_verified";
}

export interface IllegalTransitionError {
  readonly type: "illegal_transition";
  readonly reason: string;
}

export type SubmitCampaignError =
  | CampaignNotFoundError
  | BusinessNotFoundError
  | NotKybVerifiedError
  | IllegalTransitionError
  | PersistenceFailedError;

export type GetCampaignDraftError = CampaignNotFoundError | PersistenceFailedError;
export type ListCampaignDraftsError = PersistenceFailedError;
export type ListQuestionsError = PersistenceFailedError;
