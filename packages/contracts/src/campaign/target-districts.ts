/**
 * 14.2, F116: the districts a campaign is shown in. A district is a postcode
 * from the fixed area list (`../areas`), picked by suburb in Studio and
 * declared by the viewer as "my area" in Me, and matched exactly: no
 * neighbouring postcodes, no radius. (Before F116 these were free-text names;
 * `20261020140746_my_area.sql` kept the ones that were already postcodes.)
 * The length limit is the loose one `GET /api/feed?district=` still takes.
 * Dependency-free, so Studio's client code can use it without pulling in Zod.
 */
export const MAX_TARGET_DISTRICTS = 20;
export const MAX_DISTRICT_LENGTH = 60;

/** Trims and collapses inner whitespace; the spelling a business sees. */
export function normaliseDistrict(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** What two spellings of one district have in common. */
export function districtKey(name: string): string {
  return normaliseDistrict(name).toLowerCase();
}

/** Normalised, blanks dropped, duplicates removed keeping the first spelling. */
export function cleanTargetDistricts(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const name of names) {
    const normalised = normaliseDistrict(name);
    const key = normalised.toLowerCase();
    if (normalised.length === 0 || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(normalised);
  }
  return cleaned;
}

/**
 * An untargeted campaign (no districts) is shown everywhere. A targeted one
 * is shown only to a viewer whose area is one of its postcodes, so a viewer
 * with no declared area sees untargeted campaigns only: a business paying to
 * reach one area never pays for a viewer outside it.
 */
export function districtTargetMatches(
  targets: readonly string[],
  viewerDistrict: string | null | undefined,
): boolean {
  if (targets.length === 0) return true;
  if (viewerDistrict === null || viewerDistrict === undefined) return false;
  const key = districtKey(viewerDistrict);
  return key.length > 0 && targets.some((target) => districtKey(target) === key);
}
