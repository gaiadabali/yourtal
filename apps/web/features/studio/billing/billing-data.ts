import {
  billingBalanceSchema,
  purchaseQuoteSchema,
  purchaseResultSchema,
} from "@yourtal/contracts/billing";
import type { BillingAllocation, PurchaseQuote, PurchaseResult } from "@yourtal/contracts/billing";
import type { Currency } from "@yourtal/contracts/money/currency";
import { resolveStudioDataSource } from "../studio-data-source";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * Point amounts Studio offers to buy in one click. Not a server-defined
 * "pack" — 7.5.a's real endpoint quotes an arbitrary `points` amount, so
 * these are only this screen's own preset shortcuts; the price beside each
 * one is always the real, server-computed quote (never derived here).
 */
export const PRESET_POINT_AMOUNTS: readonly number[] = [50_000, 250_000, 1_000_000];

export interface BillingBalance {
  totalPoints: number;
  remainingPoints: number;
  /** This business's own funded point allocations — a reward config names one of these (7.3.c). `GET .../billing/balance` returns them alongside the totals, no separate list-allocations endpoint needed (per the coordinator: F14/7.8.b). */
  allocations: BillingAllocation[];
}

interface BillingDataSource {
  quotePoints: (businessId: string, points: number, currency: Currency) => Promise<PurchaseQuote>;
  getBalance: (businessId: string) => Promise<BillingBalance>;
  purchasePoints: (
    businessId: string,
    points: number,
    currency: Currency,
    idempotencyKey: string,
  ) => Promise<PurchaseResult>;
}

/**
 * `businessId` doubles as `:tenantId`, same rule every other Studio data
 * module states — a business only ever buys points for itself.
 */
const liveDataSource: BillingDataSource = {
  quotePoints: async (businessId, points) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/billing/purchases/quote?points=${points}`,
      purchaseQuoteSchema,
    );
    if (!result.ok) throw new Error(`Could not quote points: ${result.error.message}`);
    return result.data;
  },
  getBalance: async (businessId) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/billing/balance`,
      billingBalanceSchema,
    );
    if (!result.ok) throw new Error(`Could not load balance: ${result.error.message}`);
    return {
      totalPoints: result.data.totalPoints,
      remainingPoints: result.data.remainingPoints,
      allocations: [...result.data.allocations],
    };
  },
  purchasePoints: async (businessId, points, currency, idempotencyKey) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/billing/purchases`,
      purchaseResultSchema,
      {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: { points, currency },
      },
    );
    if (!result.ok) throw new Error(`Could not buy points: ${result.error.message}`);
    return result.data;
  },
};

interface MockState {
  totalPoints: number;
  remainingPoints: number;
  allocations: BillingAllocation[];
}

const mockStateByBusinessId = new Map<string, MockState>();

function mockStateFor(businessId: string): MockState {
  const existing = mockStateByBusinessId.get(businessId);
  if (existing) return existing;
  const created: MockState = { totalPoints: 0, remainingPoints: 0, allocations: [] };
  mockStateByBusinessId.set(businessId, created);
  return created;
}

// Flat, fixture-only price-per-point — never derived from B (the backing
// rate), which never reaches a client (CLAUDE.md, task 7.8.c). The real
// `quotePurchase` (7.5.a) is what this mock stands in for.
const MOCK_MINOR_PER_POINT: Record<Currency, number> = { AUD: 3, IDR: 4 };

const mockDataSource: BillingDataSource = {
  quotePoints: (_businessId, points, currency) =>
    Promise.resolve({
      points: toPoints(points),
      totalMinor: toMinorUnits(points * MOCK_MINOR_PER_POINT[currency]),
      currency,
    }),
  getBalance: (businessId) => {
    const state = mockStateFor(businessId);
    return Promise.resolve({
      totalPoints: state.totalPoints,
      remainingPoints: state.remainingPoints,
      allocations: state.allocations,
    });
  },
  purchasePoints: (businessId, points, currency) => {
    const state = mockStateFor(businessId);
    const paidMinor = points * MOCK_MINOR_PER_POINT[currency];
    state.totalPoints += points;
    state.remainingPoints += points;
    const allocation: BillingAllocation = {
      allocationId: crypto.randomUUID(),
      region: currency === "AUD" ? ("AU" as const) : ("ID" as const),
      funderType: "partner" as const,
      totalPoints: toPoints(points),
      remainingPoints: toPoints(points),
      createdAt: new Date().toISOString(),
    };
    state.allocations = [...state.allocations, allocation];
    return Promise.resolve({
      allocation,
      paidMinor: toMinorUnits(paidMinor),
      currency,
      providerReference: `mock_${crypto.randomUUID()}`,
    });
  },
};

const billingDataSource = resolveStudioDataSource({ mock: mockDataSource, live: liveDataSource });

export function quotePoints(
  businessId: string,
  points: number,
  currency: Currency,
): Promise<PurchaseQuote> {
  return billingDataSource.quotePoints(businessId, points, currency);
}

export function getBalance(businessId: string): Promise<BillingBalance> {
  return billingDataSource.getBalance(businessId);
}

export function purchasePoints(
  businessId: string,
  points: number,
  currency: Currency,
  idempotencyKey: string,
): Promise<PurchaseResult> {
  return billingDataSource.purchasePoints(businessId, points, currency, idempotencyKey);
}
