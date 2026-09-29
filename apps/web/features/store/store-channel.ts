import type { ListingChannel, PublicListing } from "@yourtal/contracts/listing";
import { getStoreTranslator, type SupportedLocale } from "./store-i18n";

/**
 * Channel filter for the Store browse grid (11.6.a: "filters (category,
 * channel, price)"). Spelled out rather than derived from
 * `listingChannelSchema.options` for the same reason `store-category.ts`
 * gives: this module is reachable from the client leaf
 * `store-board-controls.tsx`, and a value import of the Zod schema would
 * drag the whole runtime into the store bundle.
 */
const LISTING_CHANNELS = [
  "in_store",
  "online",
  "both",
] as const satisfies readonly ListingChannel[];

type MissingChannel = Exclude<ListingChannel, (typeof LISTING_CHANNELS)[number]>;
const _allChannelsCovered: MissingChannel extends never ? true : never = true;

export const STORE_CHANNEL_FILTER_VALUES = ["all", ...LISTING_CHANNELS] as const;
export type StoreChannelFilter = (typeof STORE_CHANNEL_FILTER_VALUES)[number];

export const DEFAULT_STORE_CHANNEL_FILTER: StoreChannelFilter = "all";

/** Every channel filter option, translated for `locale`, including the "all" pseudo-channel. */
export function storeChannelFilterOptions(
  locale: SupportedLocale,
): ReadonlyArray<{ key: StoreChannelFilter; label: string }> {
  const t = getStoreTranslator(locale);
  return [
    { key: "all", label: t("store.channelAll") },
    ...LISTING_CHANNELS.map((channel) => ({ key: channel, label: t(`store.channel.${channel}`) })),
  ];
}

/**
 * Locale-aware display label for a listing's own channel (11.6.b: the offer
 * page shows where a listing may be redeemed) — same convention as
 * `store-category.ts`'s `categoryLabel`.
 */
export function channelLabel(channel: ListingChannel, locale: SupportedLocale): string {
  const t = getStoreTranslator(locale);
  return t(`store.channel.${channel}`);
}

export function isStoreChannelFilter(value: string): value is StoreChannelFilter {
  return (STORE_CHANNEL_FILTER_VALUES as readonly string[]).includes(value);
}

export function filterListingsByChannel(
  listings: readonly PublicListing[],
  channel: StoreChannelFilter,
): PublicListing[] {
  if (channel === "all") {
    return [...listings];
  }
  const wanted: ListingChannel = channel;
  return listings.filter((listing) => listing.channel === wanted);
}
