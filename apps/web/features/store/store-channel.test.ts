import { describe, expect, it } from "vitest";
import type { Listing } from "@yourtal/contracts/listing";
import { soldOutListingFixture } from "@yourtal/contracts/listing/mock";
import {
  STORE_CHANNEL_FILTER_VALUES,
  filterListingsByChannel,
  isStoreChannelFilter,
  storeChannelFilterOptions,
} from "./store-channel";

const inStoreListing: Listing = {
  ...soldOutListingFixture,
  id: "11111111-1111-4111-8111-111111111111",
  channel: "in_store",
};
const onlineListing: Listing = {
  ...soldOutListingFixture,
  id: "22222222-2222-4222-8222-222222222222",
  channel: "online",
};

describe("filterListingsByChannel", () => {
  it("returns every listing, unmutated order, for 'all'", () => {
    expect(filterListingsByChannel([inStoreListing, onlineListing], "all")).toEqual([
      inStoreListing,
      onlineListing,
    ]);
  });

  it("keeps only listings matching the given channel", () => {
    expect(filterListingsByChannel([inStoreListing, onlineListing], "online")).toEqual([
      onlineListing,
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [inStoreListing, onlineListing];
    const copy = [...input];
    filterListingsByChannel(input, "online");
    expect(input).toEqual(copy);
  });
});

describe("isStoreChannelFilter", () => {
  it("accepts every declared filter value", () => {
    for (const value of STORE_CHANNEL_FILTER_VALUES) {
      expect(isStoreChannelFilter(value)).toBe(true);
    }
  });

  it("rejects an arbitrary string", () => {
    expect(isStoreChannelFilter("drone_delivery")).toBe(false);
  });
});

describe("storeChannelFilterOptions", () => {
  it("returns one option per channel plus 'all', translated (en-AU)", () => {
    const options = storeChannelFilterOptions("en-AU");
    expect(options.map((option) => option.key)).toStrictEqual([
      "all",
      "in_store",
      "online",
      "both",
    ]);
    expect(options[0]?.label).toBe("All channels");
  });

  it("translates into Indonesian (id-ID)", () => {
    const options = storeChannelFilterOptions("id-ID");
    expect(options[0]?.label).toBe("Semua kanal");
  });
});
