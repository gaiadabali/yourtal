import type { Currency } from "@yourtal/contracts/money/currency";
import { resolveDataSource } from "@yourtal/contracts/mock-source";

export interface PointsPack {
  id: string;
  points: number;
  priceMinor: number;
  currency: Currency;
}

export interface BillingBalance {
  availablePoints: number;
  currency: Currency;
}

export interface PurchaseRecord {
  id: string;
  packId: string;
  points: number;
  priceMinor: number;
  currency: Currency;
  purchasedAt: string;
}

// Flat, fixture-only prices — never derived from B (the backing rate), which
// never reaches a client (CLAUDE.md, task 7.8.c). `quotePurchase` (7.5.a) is
// the real, server-computed quote this screen calls once it lands.
const PACKS_BY_CURRENCY: Record<Currency, PointsPack[]> = {
  AUD: [
    { id: "pack-s", points: 50_000, priceMinor: 150_000, currency: "AUD" },
    { id: "pack-m", points: 250_000, priceMinor: 700_000, currency: "AUD" },
    { id: "pack-l", points: 1_000_000, priceMinor: 2_600_000, currency: "AUD" },
  ],
  IDR: [
    { id: "pack-s", points: 500_000, priceMinor: 1_500_000, currency: "IDR" },
    { id: "pack-m", points: 2_500_000, priceMinor: 7_000_000, currency: "IDR" },
    { id: "pack-l", points: 10_000_000, priceMinor: 26_000_000, currency: "IDR" },
  ],
};

interface BillingState {
  balance: BillingBalance;
  purchases: PurchaseRecord[];
}

const stateByBusinessId = new Map<string, BillingState>();

function stateFor(businessId: string, currency: Currency): BillingState {
  const existing = stateByBusinessId.get(businessId);
  if (existing) return existing;
  const created: BillingState = { balance: { availablePoints: 0, currency }, purchases: [] };
  stateByBusinessId.set(businessId, created);
  return created;
}

interface BillingDataSource {
  listPacks: (currency: Currency) => Promise<PointsPack[]>;
  getBalance: (businessId: string, currency: Currency) => Promise<BillingBalance>;
  listPurchases: (businessId: string) => Promise<PurchaseRecord[]>;
  purchasePack: (businessId: string, packId: string, currency: Currency) => Promise<PurchaseRecord>;
}

const mockDataSource: BillingDataSource = {
  listPacks: (currency) => Promise.resolve(PACKS_BY_CURRENCY[currency]),
  getBalance: (businessId, currency) => Promise.resolve(stateFor(businessId, currency).balance),
  listPurchases: (businessId) =>
    Promise.resolve(stateByBusinessId.get(businessId)?.purchases ?? []),
  purchasePack: (businessId, packId, currency) => {
    const pack = PACKS_BY_CURRENCY[currency].find((candidate) => candidate.id === packId);
    if (!pack) return Promise.reject(new Error(`Unknown pack: ${packId}`));
    const state = stateFor(businessId, currency);
    const record: PurchaseRecord = {
      id: crypto.randomUUID(),
      packId: pack.id,
      points: pack.points,
      priceMinor: pack.priceMinor,
      currency,
      purchasedAt: new Date().toISOString(),
    };
    state.purchases = [record, ...state.purchases];
    state.balance = { availablePoints: state.balance.availablePoints + pack.points, currency };
    return Promise.resolve(record);
  },
};

const NOT_IMPLEMENTED_MESSAGE =
  "Live billing data source is not implemented yet — 7.5's purchase API has not landed on main.";

const liveDataSource: BillingDataSource = {
  listPacks: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  getBalance: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  listPurchases: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
  purchasePack: () => Promise.reject(new Error(NOT_IMPLEMENTED_MESSAGE)),
};

const billingDataSource = resolveDataSource({ mock: mockDataSource, live: liveDataSource });

export function listPacks(currency: Currency): Promise<PointsPack[]> {
  return billingDataSource.listPacks(currency);
}

export function getBalance(businessId: string, currency: Currency): Promise<BillingBalance> {
  return billingDataSource.getBalance(businessId, currency);
}

export function listPurchases(businessId: string): Promise<PurchaseRecord[]> {
  return billingDataSource.listPurchases(businessId);
}

export function purchasePack(
  businessId: string,
  packId: string,
  currency: Currency,
): Promise<PurchaseRecord> {
  return billingDataSource.purchasePack(businessId, packId, currency);
}
