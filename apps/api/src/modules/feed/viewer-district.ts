import type { Principal } from "@yourtal/authz/principal";
import type { FeedSignalsRepository } from "./persistence/feed-signals.repository";

/**
 * F116: the district the feed and search match targeted campaigns against.
 * An explicit `?district=` wins; otherwise a signed-in adult's declared "my
 * area". A teen never has one (the API refuses it) and is not asked, and an
 * anonymous viewer has only what they pass.
 */
export async function resolveViewerDistrict(
  signals: Pick<FeedSignalsRepository, "declaredAreaPostcode">,
  principal: Principal,
  explicit: string | undefined,
): Promise<string | null> {
  if (explicit !== undefined) return explicit;
  if (principal.id === "anonymous" || principal.attr.ageBand === "teen") return null;
  return signals.declaredAreaPostcode(principal.id);
}
