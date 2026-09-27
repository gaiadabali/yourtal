import type { FeedChannelResult } from "@yourtal/contracts/feed";

/** 7.7.c: the "channels" half of search -- businesses, region- and audience-walled the same way listings/campaigns are. */
export interface ChannelSearchRepository {
  search(query: string, region: string, limit: number): Promise<readonly FeedChannelResult[]>;
}

export const CHANNEL_SEARCH_REPOSITORY = Symbol("CHANNEL_SEARCH_REPOSITORY");
