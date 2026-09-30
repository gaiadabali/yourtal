import * as z from "zod";
import { blockedTermIn, isKnownInterestNode } from "./taxonomy";

/**
 * 13.11 (F84): tags on campaigns and listings are interest-taxonomy node ids,
 * never free text, so they match the viewer's declared interests and the
 * sensitive-term block applies (the taxonomy refuses sensitive nodes at load;
 * the second check guards against a future node slipping through).
 */
export const MAX_TAGS = 8;

export const interestTagSchema = z
  .string()
  .refine(isKnownInterestNode, { message: "unknown interest node id" })
  .refine((id) => blockedTermIn(id) === null, { message: "sensitive interest node" });

export const interestTagsSchema = z
  .array(interestTagSchema)
  .max(MAX_TAGS)
  .refine((tags) => new Set(tags).size === tags.length, { message: "tags must be unique" });
export type InterestTags = z.infer<typeof interestTagsSchema>;

/**
 * A stored tag list, read back leniently: an id the taxonomy no longer knows
 * is dropped rather than failing the whole row's parse and hiding it.
 */
export function storedTagsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const known = raw.filter(
    (tag): tag is string => typeof tag === "string" && interestTagSchema.safeParse(tag).success,
  );
  return [...new Set(known)].slice(0, MAX_TAGS);
}

/**
 * A list query param: `tags=a,b` or `tags=a&tags=b`, both accepted. Empty
 * entries are dropped, so `tags=` means "no filter", not a 400.
 */
export function csvListParam<T extends z.ZodType>(item: T, max: number) {
  return z.preprocess((raw) => {
    if (raw === undefined) return undefined;
    const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((value) => String(value).split(","));
    const trimmed = parts.map((part) => part.trim()).filter((part) => part.length > 0);
    return trimmed.length === 0 ? undefined : [...new Set(trimmed)];
  }, z.array(item).min(1).max(max).optional());
}

/** One facet bucket: a value present in the result set and how many rows carry it. */
export const facetCountSchema = z.object({
  value: z.string().min(1),
  count: z.number().int().min(0),
});
export type FacetCount = z.infer<typeof facetCountSchema>;
