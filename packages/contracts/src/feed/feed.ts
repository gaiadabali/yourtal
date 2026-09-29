import { z } from "zod";
import { contentCategorySchema } from "@yourtal/jurisdiction/content-category";
import { pointsSchema } from "../money/money";
import { regionSchema } from "../region/region";
import { audienceSchema } from "../audience/audience";
import { publicListingSchema } from "../listing/listing";
import { campaignKindSchema, campaignSchema } from "../campaign/campaign";

/**
 * 7.7: the feed/discovery response shape. `packages/contracts/src/feed` is
 * Area B's folder (the ownership table names it as such), but nothing was
 * in it yet when this landed -- created here as the working shape so 7.7
 * has something real to build and test against; Area B owns adjusting it
 * from here. Additive only if it changes: nothing here is removed without
 * saying so in the commit that does it.
 */
export const feedWhyReasonSchema = z.enum([
  "followed",
  "interest",
  "audience",
  "ending_soon",
  "popular",
]);
export type FeedWhyReason = z.infer<typeof feedWhyReasonSchema>;

export const feedSurfaceSchema = z.enum(["home", "watch"]);
export type FeedSurface = z.infer<typeof feedSurfaceSchema>;

/**
 * One campaign card. Deliberately NOT the full `Campaign` contract --
 * `feed.ts`'s own filter/rank never needs chapters, video sources or terms,
 * and `why`/`endingSoon` are feed-specific, not properties of the campaign
 * itself.
 */
export const feedItemSchema = z.object({
  campaignId: z.uuid(),
  businessId: z.uuid(),
  merchantName: z.string().min(1),
  title: z.string().min(1),
  synopsis: z.string(),
  posterUrl: z.url(),
  teaserUrl: z.url(),
  durationSeconds: z.number().int().positive(),
  rewardPoints: pointsSchema,
  /** 11.4.a's honest terms line (F78): quick campaigns earn in the feed (F15). */
  kind: campaignKindSchema,
  questionCount: z.number().int().min(0),
  /** Base plus the maximum accuracy bonus, from the reward config: what "up to" means. */
  maxRewardPoints: pointsSchema,
  estimatedDataMb: z.number().positive(),
  contentCategory: contentCategorySchema,
  audience: audienceSchema,
  region: regionSchema,
  openViewing: z.boolean(),
  /** EW-16: `endsAt` within 72h, or allocation remaining below 10%. */
  endingSoon: z.boolean(),
  /** One short, human-readable reason this item is here (docs/17 "why"). */
  why: z.string().min(1),
  /** The same reason as a code, so clients can say it in the viewer's language (F78). */
  whyReason: feedWhyReasonSchema,
  /**
   * 11.5.d: the funder's own channel, for the Home card's channel row and
   * a link to `/c/[handle]`. Every seeded business has a handle (migration
   * `20260925190000`'s `business_accounts_handle_key`), so this is a plain
   * string, never optional -- only the logo is nullable, same as
   * `feedChannelResultSchema.logoUrl` below.
   */
  channelHandle: z.string().min(1),
  channelLogoUrl: z.url().nullable(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedResponseSchema = z.object({
  surface: feedSurfaceSchema,
  items: z.array(feedItemSchema),
});
export type FeedResponse = z.infer<typeof feedResponseSchema>;

export const feedChannelResultSchema = z.object({
  businessId: z.uuid(),
  displayName: z.string(),
  handle: z.string(),
  logoUrl: z.url().nullable(),
  region: regionSchema,
});
export type FeedChannelResult = z.infer<typeof feedChannelResultSchema>;

export const searchResponseSchema = z.object({
  campaigns: z.array(feedItemSchema),
  channels: z.array(feedChannelResultSchema),
  listings: z.array(publicListingSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/**
 * 11.5.d: `GET /api/channels/:handle` (and its by-id sibling for a caller
 * that only has a `businessId`, e.g. the watch page's channel row) — the
 * business's own page: cover/logo, its still-live campaigns and its own
 * store listings. `campaigns` is the full `Campaign` shape (not `FeedItem`):
 * a channel page is not a ranked feed -- no `why`, no session-scoped signals
 * -- so there is nothing here `buildFeed`'s ranking would add.
 */
export const channelReadResponseSchema = z.object({
  channel: feedChannelResultSchema,
  campaigns: z.array(campaignSchema),
  listings: z.array(publicListingSchema),
});
export type ChannelReadResponse = z.infer<typeof channelReadResponseSchema>;
