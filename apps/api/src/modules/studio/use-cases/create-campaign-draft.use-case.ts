import { errAsync, ResultAsync } from "neverthrow";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";
import type { Audience } from "@yourtal/contracts/campaign";
import type { CampaignKind } from "@yourtal/contracts/campaign";
import type { BusinessAccountRepository } from "../../business/persistence/business-account.repository";
import type {
  CampaignDraft,
  CampaignDraftRepository,
} from "../persistence/campaign-draft.repository";
import type { CreateCampaignDraftError } from "../studio.errors";
import { categoryRefusal, openViewingRefusal } from "./category-policy";

export interface CreateCampaignDraftInput {
  readonly businessId: string;
  readonly kind: CampaignKind;
  readonly title: string;
  readonly synopsis: string;
  readonly durationSeconds: number;
  readonly contentCategory: ContentCategory;
  readonly audience: Audience;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly openViewing: boolean;
  readonly teaserStartSeconds: number;
  readonly declaredInterests: readonly string[];
}

/**
 * TASKS.md 7.3.a: a `prohibited` category is refused at save (1.1.d); a
 * `restricted` (adult_only) one forces `audience: "adult"`. Region and
 * currency are never the caller's to name — the business's own region
 * decides them (F2), the same reasoning `create-business.controller.ts`
 * already documents for `currency`.
 */
export function createCampaignDraft(
  deps: {
    readonly businesses: BusinessAccountRepository;
    readonly drafts: CampaignDraftRepository;
  },
  input: CreateCampaignDraftInput,
): ResultAsync<CampaignDraft, CreateCampaignDraftError> {
  return ResultAsync.fromPromise(
    deps.businesses.findById(input.businessId),
    (cause): CreateCampaignDraftError => ({ type: "persistence_failed", cause: String(cause) }),
  ).andThen((business) => {
    if (business === null) {
      return errAsync<CampaignDraft, CreateCampaignDraftError>({
        type: "business_not_found",
        businessId: input.businessId,
      });
    }
    const refusal = categoryRefusal(business.region, input.contentCategory, input.audience);
    if (refusal !== null) {
      return errAsync<CampaignDraft, CreateCampaignDraftError>(refusal);
    }
    const openViewingIssue = openViewingRefusal(input.openViewing, input.audience);
    if (openViewingIssue !== null) {
      return errAsync<CampaignDraft, CreateCampaignDraftError>(openViewingIssue);
    }
    return ResultAsync.fromPromise(
      deps.drafts.create({
        businessId: input.businessId,
        region: business.region,
        merchantName: business.displayName,
        kind: input.kind,
        title: input.title,
        synopsis: input.synopsis,
        durationSeconds: input.durationSeconds,
        contentCategory: input.contentCategory,
        audience: input.audience,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        openViewing: input.openViewing,
        teaserStartSeconds: input.teaserStartSeconds,
        declaredInterests: input.declaredInterests,
      }),
      (cause): CreateCampaignDraftError => ({ type: "persistence_failed", cause: String(cause) }),
    );
  });
}
