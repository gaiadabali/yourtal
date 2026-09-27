import { categoryPolicy } from "@yourtal/jurisdiction/content-category";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";
import type { Audience } from "@yourtal/contracts/campaign";
import type { Region } from "@yourtal/contracts/region";
import type {
  AudienceMustBeAdultError,
  OpenViewingRequiresAllAgesError,
  ProhibitedCategoryError,
} from "../studio.errors";

/**
 * TASKS.md 7.3.a / 1.1.d, shared by create and update: a `prohibited`
 * category is refused outright; an `adult_only` one is refused unless
 * `audience` is already `"adult"` — never silently coerced, since audience
 * is a real declared choice with its own cascading effects (feed reach,
 * notifications).
 */
export function categoryRefusal(
  region: Region,
  category: ContentCategory,
  audience: Audience,
): ProhibitedCategoryError | AudienceMustBeAdultError | null {
  const status = categoryPolicy(region, category);
  if (status === "prohibited") {
    return { type: "prohibited_category", category };
  }
  if (status === "adult_only" && audience !== "adult") {
    return { type: "audience_must_be_adult", category };
  }
  return null;
}

/** F8: Open Viewing is off by default and may only ever be turned on for an all_ages campaign. */
export function openViewingRefusal(
  openViewing: boolean,
  audience: Audience,
): OpenViewingRequiresAllAgesError | null {
  return openViewing && audience !== "all_ages" ? { type: "open_viewing_requires_all_ages" } : null;
}
