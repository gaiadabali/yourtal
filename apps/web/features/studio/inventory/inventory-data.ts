import { z } from "zod";
import { listingSchema, settlementDecreaseRequestSchema } from "@yourtal/contracts/listing";
import { merchantLocationSchema } from "@yourtal/contracts/listing/merchant-location";
import type { Listing, SettlementDecreaseRequest } from "@yourtal/contracts/listing";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import type { Currency } from "@yourtal/contracts/money/currency";
import type { Region } from "@yourtal/contracts/region";
import { resolveDataSource } from "@yourtal/contracts/mock-source";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { apiFetch } from "@/lib/api/api-fetch";

export type { SettlementDecreaseRequest };

const listingsResponseSchema = z.object({ listings: z.array(listingSchema) });
const locationsResponseSchema = z.object({ locations: z.array(merchantLocationSchema) });
const decreaseRequestsResponseSchema = z.object({
  requests: z.array(settlementDecreaseRequestSchema),
});

interface InventoryDataSource {
  listListings: (
    businessId: string,
    merchantName: string,
    region: Region,
    currency: Currency,
  ) => Promise<Listing[]>;
  listLocations: (
    businessId: string,
    merchantName: string,
    region: Region,
    currency: Currency,
  ) => Promise<MerchantLocation[]>;
  listPendingDecreaseRequests: (businessId: string) => Promise<SettlementDecreaseRequest[]>;
}

/**
 * `businessId` doubles as `:tenantId` — a business only ever manages its
 * own inventory, same rule `StoreListingController`'s own doc comment
 * states server-side.
 */
const liveDataSource: InventoryDataSource = {
  listListings: async (businessId) => {
    const result = await apiFetch(`/api/${businessId}/store/listings`, listingsResponseSchema);
    if (!result.ok) throw new Error(`Could not load listings: ${result.error.message}`);
    return result.data.listings;
  },
  listLocations: async (businessId) => {
    const result = await apiFetch(`/api/${businessId}/store/locations`, locationsResponseSchema);
    if (!result.ok) throw new Error(`Could not load locations: ${result.error.message}`);
    return result.data.locations;
  },
  listPendingDecreaseRequests: async (businessId) => {
    const result = await apiFetch(
      `/api/${businessId}/store/settlement-decreases?state=pending`,
      decreaseRequestsResponseSchema,
    );
    if (!result.ok) {
      throw new Error(`Could not load pending settlement decreases: ${result.error.message}`);
    }
    return result.data.requests;
  },
};

function mockLocation(
  businessId: string,
  name: string,
  address: string,
  district: string,
): MerchantLocation {
  return {
    id: `${businessId}-loc-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    address,
    district,
  };
}

function mockListing(input: {
  businessId: string;
  merchantName: string;
  region: Region;
  currency: Currency;
  title: string;
  faceValueMinor: number;
  settlementValueMinor: number;
  priceInPoints: number;
  stockTotal: number;
  stockRemaining: number;
  locations: MerchantLocation[];
}): Listing {
  return {
    id: `${input.businessId}-listing-${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    merchantId: input.businessId,
    merchantName: input.merchantName,
    title: input.title,
    description: `${input.title} from ${input.merchantName}.`,
    category: "food_beverage",
    locations: input.locations,
    currency: input.currency,
    faceValueMinor: toMinorUnits(input.faceValueMinor),
    settlementValueMinor: toMinorUnits(input.settlementValueMinor),
    priceInPoints: toPoints(input.priceInPoints),
    stockRemaining: input.stockRemaining,
    stockTotal: input.stockTotal,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendMinor: null,
    expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    status: input.stockRemaining === 0 ? "sold_out" : "available",
    region: input.region,
    audience: "all_ages",
    contentCategory: "food-and-drink",
    imageUrl: "https://images.example.com/listings/placeholder.jpg",
    channel: "in_store",
    partialRedemption: "single_use",
  };
}

const mockStateByBusinessId = new Map<
  string,
  { listings: Listing[]; locations: MerchantLocation[] }
>();

function mockStateFor(
  businessId: string,
  merchantName: string,
  region: Region,
  currency: Currency,
) {
  const existing = mockStateByBusinessId.get(businessId);
  if (existing) return existing;
  const outlet = mockLocation(businessId, "Main outlet", "1 Example St", "Central");
  const created = {
    listings: [
      mockListing({
        businessId,
        merchantName,
        region,
        currency,
        title: "Signature combo",
        faceValueMinor: currency === "AUD" ? 2_500 : 45_000,
        settlementValueMinor: currency === "AUD" ? 1_800 : 32_000,
        priceInPoints: 1_800,
        stockTotal: 100,
        stockRemaining: 62,
        locations: [outlet],
      }),
    ],
    locations: [outlet],
  };
  mockStateByBusinessId.set(businessId, created);
  return created;
}

const mockDataSource: InventoryDataSource = {
  listListings: (businessId, merchantName, region, currency) =>
    Promise.resolve(mockStateFor(businessId, merchantName, region, currency).listings),
  listLocations: (businessId, merchantName, region, currency) =>
    Promise.resolve(mockStateFor(businessId, merchantName, region, currency).locations),
  listPendingDecreaseRequests: () => Promise.resolve([]),
};

const inventoryDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

export function listListings(
  businessId: string,
  merchantName: string,
  region: Region,
  currency: Currency,
): Promise<Listing[]> {
  return inventoryDataSource.listListings(businessId, merchantName, region, currency);
}

export function listLocations(
  businessId: string,
  merchantName: string,
  region: Region,
  currency: Currency,
): Promise<MerchantLocation[]> {
  return inventoryDataSource.listLocations(businessId, merchantName, region, currency);
}

export function listPendingDecreaseRequests(
  businessId: string,
): Promise<SettlementDecreaseRequest[]> {
  return inventoryDataSource.listPendingDecreaseRequests(businessId);
}
