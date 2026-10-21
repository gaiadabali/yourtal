import * as z from "zod";
import {
  billingBalanceSchema,
  billingCardSchema,
  billingStatementSchema,
  budgetAlertsSchema,
  cardPurchaseSchema,
  pointPackagesSchema,
  purchaseResultSchema,
  startCardSetupResultSchema,
} from "@yourtal/contracts/billing";
import type {
  BillingAllocation,
  BillingCard,
  BillingStatement,
  BudgetAlert,
  CardPurchase,
  PointPackage,
  PurchaseResult,
  StartCardSetupResult,
} from "@yourtal/contracts/billing";
import { payoutLinkSchema, studioPayoutsSchema } from "@yourtal/contracts/billing/payouts";
import type { PayoutLink, StudioPayouts } from "@yourtal/contracts/billing/payouts";
import type { Currency } from "@yourtal/contracts/money/currency";
import { resolveStudioDataSource } from "../studio-data-source";
import { toPoints } from "@yourtal/contracts/money";
import { apiFetch } from "@/lib/api/api-fetch";
import { mockPackages } from "./billing-mock-packages";

export interface BillingBalance {
  totalPoints: number;
  remainingPoints: number;
  /** This business's own funded point allocations — a reward config names one of these (7.3.c). `GET .../billing/balance` returns them alongside the totals, no separate list-allocations endpoint needed (per the coordinator: F14/7.8.b). */
  allocations: BillingAllocation[];
}

interface BillingDataSource {
  /** F121/F122: the packages on sale in this business's region, smallest first. The server prices them; `currency` only picks the fixture's catalogue. */
  listPackages: (businessId: string, currency: Currency) => Promise<PointPackage[]>;
  /** 14.13.b: package and campaign budget alerts, newest first. */
  getAlerts: (businessId: string) => Promise<BudgetAlert[]>;
  getBalance: (businessId: string) => Promise<BillingBalance>;
  purchasePoints: (
    businessId: string,
    tierKey: string,
    currency: Currency,
    idempotencyKey: string,
  ) => Promise<PurchaseResult>;
  /** 5.1.a: a card purchase's status, for the page the checkout returns to. Null if not this business's. */
  getPurchase: (businessId: string, purchaseId: string) => Promise<CardPurchase | null>;
  getCard: (businessId: string) => Promise<BillingCard>;
  startCardSetup: (businessId: string) => Promise<StartCardSetupResult>;
  /** 5.2: where approved statements are paid, and how each one is going. */
  getPayouts: (businessId: string) => Promise<StudioPayouts>;
  startPayoutLink: (businessId: string) => Promise<PayoutLink>;
  getStatements: (businessId: string) => Promise<BillingStatement[]>;
}

const NO_PAYOUTS: StudioPayouts = {
  account: { available: false, state: "not_started", bankLast4: null, hostedOnboarding: false },
  payoutFailed: false,
  waitingForAccount: false,
  payouts: [],
};

/**
 * `businessId` doubles as `:tenantId`, same rule every other Studio data
 * module states — a business only ever buys points for itself.
 */
const liveDataSource: BillingDataSource = {
  listPackages: async (businessId) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/billing/packages`,
      pointPackagesSchema,
    );
    if (!result.ok) throw new Error(`Could not load packages: ${result.error.message}`);
    return result.data.packages;
  },
  getAlerts: async (businessId) => {
    const result = await apiFetch(`/api/${businessId}/studio/billing/alerts`, budgetAlertsSchema);
    // A failed read hides the list rather than breaking the whole Billing page.
    return result.ok ? result.data.alerts : [];
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
  purchasePoints: async (businessId, tierKey, currency, idempotencyKey) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/billing/purchases`,
      purchaseResultSchema,
      {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: { tierKey, currency },
      },
    );
    if (!result.ok) throw new Error(`Could not buy points: ${result.error.message}`);
    return result.data;
  },
  getPurchase: async (businessId, purchaseId) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/billing/purchases/${encodeURIComponent(purchaseId)}`,
      cardPurchaseSchema,
    );
    return result.ok ? result.data : null;
  },
  getCard: async (businessId) => {
    const result = await apiFetch(`/api/${businessId}/studio/billing/card`, billingCardSchema);
    // A failed read shows no card rather than breaking the whole Billing page.
    return result.ok ? result.data : { card: null, required: false };
  },
  startCardSetup: async (businessId) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/billing/card`,
      startCardSetupResultSchema,
      { method: "POST", body: {} },
    );
    if (!result.ok) throw new Error(`Could not start saving a card: ${result.error.message}`);
    return result.data;
  },
  getPayouts: async (businessId) => {
    const result = await apiFetch(`/api/${businessId}/studio/billing/payouts`, studioPayoutsSchema);
    // A failed read hides the panel rather than breaking the whole Billing page.
    return result.ok ? result.data : NO_PAYOUTS;
  },
  startPayoutLink: async (businessId) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/billing/payouts/link`,
      payoutLinkSchema,
      { method: "POST", body: {} },
    );
    if (!result.ok) throw new Error(`Could not open payout details: ${result.error.message}`);
    return result.data;
  },
  getStatements: async (businessId) => {
    const result = await apiFetch(
      `/api/${businessId}/studio/billing/statements`,
      z.array(billingStatementSchema),
    );
    return result.ok ? result.data : [];
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

const mockDataSource: BillingDataSource = {
  listPackages: (_businessId, currency) => Promise.resolve(mockPackages(currency)),
  getAlerts: () => Promise.resolve([]),
  getBalance: (businessId) => {
    const state = mockStateFor(businessId);
    return Promise.resolve({
      totalPoints: state.totalPoints,
      remainingPoints: state.remainingPoints,
      allocations: state.allocations,
    });
  },
  purchasePoints: (businessId, tierKey, currency) => {
    const state = mockStateFor(businessId);
    const quote = mockPackages(currency).find((candidate) => candidate.tierKey === tierKey);
    if (!quote) return Promise.reject(new Error(`Unknown package: ${tierKey}`));
    const points = quote.points;
    state.totalPoints += points;
    state.remainingPoints += points;
    const allocation: BillingAllocation = {
      allocationId: crypto.randomUUID(),
      region: currency === "AUD" ? ("AU" as const) : ("ID" as const),
      funderType: "partner" as const,
      totalPoints: toPoints(points),
      remainingPoints: toPoints(points),
      programme: null,
      createdAt: new Date().toISOString(),
    };
    state.allocations = [...state.allocations, allocation];
    const purchaseId = crypto.randomUUID();
    // The fixture settles at once, like the simulated payments driver.
    return Promise.resolve({
      status: "paid" as const,
      purchaseId,
      checkoutUrl: null,
      allocation,
      purchase: {
        purchaseId,
        status: "paid" as const,
        tierKey,
        points: quote.points,
        subtotalMinor: quote.subtotalMinor,
        taxMinor: quote.taxMinor,
        totalMinor: quote.totalMinor,
        taxRateBps: quote.taxRateBps,
        currency,
        allocationId: allocation.allocationId,
        programme: null,
        createdAt: allocation.createdAt,
        paidAt: allocation.createdAt,
      },
    });
  },
  getPurchase: () => Promise.resolve(null),
  getCard: () => Promise.resolve({ card: null, required: false }),
  startCardSetup: () =>
    Promise.resolve({
      checkoutUrl: null,
      card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2034 },
    }),
  getPayouts: () => Promise.resolve(NO_PAYOUTS),
  startPayoutLink: (businessId) =>
    Promise.resolve({
      url: `http://localhost/studio/billing?business=${encodeURIComponent(businessId)}&payouts=returned`,
    }),
  getStatements: () => Promise.resolve([]),
};

const billingDataSource = resolveStudioDataSource({ mock: mockDataSource, live: liveDataSource });

export function listPackages(businessId: string, currency: Currency): Promise<PointPackage[]> {
  return billingDataSource.listPackages(businessId, currency);
}

export function getAlerts(businessId: string): Promise<BudgetAlert[]> {
  return billingDataSource.getAlerts(businessId);
}

export function getBalance(businessId: string): Promise<BillingBalance> {
  return billingDataSource.getBalance(businessId);
}

export function purchasePoints(
  businessId: string,
  tierKey: string,
  currency: Currency,
  idempotencyKey: string,
): Promise<PurchaseResult> {
  return billingDataSource.purchasePoints(businessId, tierKey, currency, idempotencyKey);
}

export function getPurchase(businessId: string, purchaseId: string): Promise<CardPurchase | null> {
  return billingDataSource.getPurchase(businessId, purchaseId);
}

export function getCard(businessId: string): Promise<BillingCard> {
  return billingDataSource.getCard(businessId);
}

export function startCardSetup(businessId: string): Promise<StartCardSetupResult> {
  return billingDataSource.startCardSetup(businessId);
}

export function getPayouts(businessId: string): Promise<StudioPayouts> {
  return billingDataSource.getPayouts(businessId);
}

export function startPayoutLink(businessId: string): Promise<PayoutLink> {
  return billingDataSource.startPayoutLink(businessId);
}

export function getStatements(businessId: string): Promise<BillingStatement[]> {
  return billingDataSource.getStatements(businessId);
}
