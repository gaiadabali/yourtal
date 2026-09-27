import type { Currency } from "@yourtal/contracts/money/currency";
import type { Listing } from "@yourtal/contracts/listing";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import type { Region } from "@yourtal/contracts/region";
import { resolveDataSource } from "@yourtal/contracts/mock-source";

/**
 * A pending settlement-value decrease (7.4.b's two-person propose/approve
 * flow). No shared contract type exists for this yet — the real endpoints
 * (`SettlementDecreaseController`, already on `main`) return their own DTO
 * shape, which this type should be replaced by once `apps/web/lib/api`
 * gains a wrapper for it.
 */
export interface SettlementDecreaseRequest {
  id: string;
  listingId: string;
  listingTitle: string;
  currentSettlementValueMinor: number;
  proposedSettlementValueMinor: number;
  currency: Currency;
  proposedByUserId: string;
  proposedAt: string;
}

function location(businessId: string, name: string, address: string, district: string): MerchantLocation {
  return {
    id: `${businessId}-loc-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    address,
    district,
  };
}

function fixtureListing(input: {
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
    faceValueMinor: input.faceValueMinor,
    settlementValueMinor: input.settlementValueMinor,
    priceInPoints: input.priceInPoints,
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

function fixturesFor(businessId: string, merchantName: string, region: Region, currency: Currency) {
  const outlet = location(businessId, "Main outlet", "1 Example St", "Central");
  const listings = [
    fixtureListing({
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
  ];
  const decreaseRequests: SettlementDecreaseRequest[] = [];
  return { listings, decreaseRequests, locations: [outlet] };
}

const stateByBusinessId = new Map<
  string,
  { listings: Listing[]; locations: MerchantLocation[]; decreaseRequests: SettlementDecreaseRequest[] }
>();

function stateFor(businessId: string, merchantName: string, region: Region, currency: Currency) {
  const existing = stateByBusinessId.get(businessId);
  if (existing) return existing;
  const created = fixturesFor(businessId, merchantName, region, currency);
  stateByBusinessId.set(businessId, created);
  return created;
}

interface InventoryDataSource {
  listListings: (businessId: string, merchantName: string, region: Region, currency: Currency) => Promise<Listing[]>;
  listLocations: (businessId: string, merchantName: string, region: Region, currency: Currency) => Promise<MerchantLocation[]>;
  listPendingDecreaseRequests: (businessId: string) => Promise<SettlementDecreaseRequest[]>;
}

const mockDataSource: InventoryDataSource = {
  listListings: (businessId, merchantName, region, currency) =>
    Promise.resolve(stateFor(businessId, merchantName, region, currency).listings),
  listLocations: (businessId, merchantName, region, currency) =>
    Promise.resolve(stateFor(businessId, merchantName, region, currency).locations),
  listPendingDecreaseRequests: (businessId) =>
    Promise.resolve(stateByBusinessId.get(businessId)?.decreaseRequests ?? []),
};

const NOT_IMPLEMENTED_MESSAGE =
  "Live inventory data source is not implemented yet — this screen has not been wired to the real (already-merged) store/listings API.";

const liveDataSource: InventoryDataSource = {
  listListings: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  listLocations: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  listPendingDecreaseRequests: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
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

export function listPendingDecreaseRequests(businessId: string): Promise<SettlementDecreaseRequest[]> {
  return inventoryDataSource.listPendingDecreaseRequests(businessId);
}
