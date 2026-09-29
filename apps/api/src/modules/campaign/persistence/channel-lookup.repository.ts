import type { Region } from "@yourtal/contracts/region";

/**
 * 11.5.d: the channel page (`/c/[handle]`) and the watch page's channel row.
 * Reads `business.business_accounts` directly, the same "narrow read-only
 * SELECT over another module's table" convention `feed`'s
 * `suspended-business-lookup.ts` and `me`'s `followable-business.reader.ts`
 * already use, rather than depending on `business`'s own repository.
 *
 * A suspended business has no channel page at all (same rule 9.3.b already
 * applies to its campaigns leaving the feed) -- both lookups return `null`
 * for one, which the controller turns into a 404, same as a handle that
 * never existed.
 */
export interface ChannelSummary {
  readonly businessId: string;
  readonly displayName: string;
  readonly handle: string;
  readonly logoUrl: string | null;
  readonly region: Region;
}

export interface ChannelLookupRepository {
  findByHandle(handle: string): Promise<ChannelSummary | null>;
  /** For a caller that only has a `businessId` (the watch page's channel row) rather than a handle. */
  findById(businessId: string): Promise<ChannelSummary | null>;
}

export const CHANNEL_LOOKUP_REPOSITORY = Symbol("CHANNEL_LOOKUP_REPOSITORY");
