import { knownTags } from "../tag-picker";
import type { CampaignDraftDetailsPatch } from "./campaign-builder-actions";
import type { CampaignDraft } from "./campaign-draft";

/**
 * Everything the Details and Targeting tabs save, as one `PATCH` body; null while there is
 * no title, which the API refuses (a draft is created with one, so this is the author
 * clearing it). The synopsis may be empty while drafting; submitting needs one.
 *
 * No length is sent. A video's length is the server's, set when the video has been
 * processed; guessing one from chapters here made the reward limit and the question count
 * follow a figure that was not real.
 */
export function detailsPatchFor(draft: CampaignDraft): CampaignDraftDetailsPatch | null {
  if (draft.title.trim().length === 0) return null;
  return {
    title: draft.title,
    synopsis: draft.synopsis,
    contentCategory: draft.contentCategory,
    audience: draft.audience,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    openViewing: draft.openViewing,
    teaserStartSeconds: draft.teaserStartSeconds,
    captionsUrl: draft.captionsUrl,
    declaredInterests: knownTags(draft.targeting.interests),
    targetDistricts: draft.targeting.districts,
  };
}

/** Two drafts with the same key have the same details; the key of what was last saved says whether anything is waiting to be. */
export function detailsSaveKey(draft: CampaignDraft): string {
  return JSON.stringify(detailsPatchFor(draft));
}
