/**
 * 11.5.d: a feed item's `channelHandle`/`channelLogoUrl` (the Home card's
 * channel row and its link to `/c/[handle]`). Same "read `business
 * .business_accounts` directly" reasoning `suspended-business-lookup.ts`
 * documents -- a narrow batch SELECT, not a dependency on another module's
 * repository.
 */
export interface ChannelInfo {
  readonly handle: string;
  readonly logoUrl: string | null;
}

export interface ChannelLookupRepository {
  /** Every business in `businessIds` that could be found, keyed by id. Order not guaranteed; a missing key means no such business row. */
  channelsFor(businessIds: readonly string[]): Promise<ReadonlyMap<string, ChannelInfo>>;
}

export const CHANNEL_LOOKUP_REPOSITORY = Symbol("CHANNEL_LOOKUP_REPOSITORY");
