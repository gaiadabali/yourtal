import * as z from "zod";
import { minorUnitsSchema, pointsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";
import { packageTierKeySchema } from "../billing/package-tiers";

/**
 * TASKS.md 1.2.a's pricing group. `quote` never carries the backing rate
 * itself — the same reason `services/ledger/internal/api/routes.go`'s
 * `quoteResponse` omits it: whoever holds B can compute a points price
 * themselves, which is exactly what YT-0130's GRANT boundary exists to stop
 * (`REVOKE ALL ON SCHEMA ledger FROM yourtal_app`).
 */
export const quoteRequestSchema = z.object({
  region: regionSchema,
  currency: currencySchema,
  settlementMinor: minorUnitsSchema,
  /** RFC3339. Omitted means now — never a way to backdate past a rate change. */
  at: z.iso.datetime().optional(),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const quoteSchema = z.object({
  quoteId: z.uuid(),
  pricePoints: pointsSchema,
  settlementMinor: minorUnitsSchema,
  currency: currencySchema,
  /** Opaque, for audit correlation only — never resolves back to B here. */
  backingRateId: z.string().min(1),
  demandMultiplierBps: z.number().int(),
  /** 15 minutes from issue (1.2.d). */
  expiresAt: z.iso.datetime(),
  locked: z.boolean().default(false),
});
export type Quote = z.infer<typeof quoteSchema>;

export const lockQuoteRequestSchema = z.object({ quoteId: z.uuid() });
export type LockQuoteRequest = z.infer<typeof lockQuoteRequestSchema>;

/** What a listing costs a shopper. Derived from `quote`, kept distinct because a listing's price is written once, at creation. */
export const priceListingRequestSchema = z.object({
  listingId: z.uuid(),
  region: regionSchema,
  currency: currencySchema,
  settlementMinor: minorUnitsSchema,
});
export type PriceListingRequest = z.infer<typeof priceListingRequestSchema>;

export const priceListingResultSchema = z.object({
  pricePoints: pointsSchema,
  backingRateId: z.string().min(1),
});
export type PriceListingResult = z.infer<typeof priceListingResultSchema>;

/** A partner buying a points pack (F12 "Points packs"), priced at P_issue, never B. */
export const quotePurchaseRequestSchema = z.object({
  points: pointsSchema,
  region: regionSchema,
});
export type QuotePurchaseRequest = z.infer<typeof quotePurchaseRequestSchema>;

export const quotePurchaseResultSchema = z.object({
  totalMinor: minorUnitsSchema,
  currency: currencySchema,
});
export type QuotePurchaseResult = z.infer<typeof quotePurchaseResultSchema>;

/**
 * F61/TASKS.md 7.3.h: any positive point count, priced at P_issue — never
 * B. Deliberately NOT `quotePurchaseRequestSchema`/`quotePurchaseResultSchema`
 * reused under a new name: `quotePurchase` prices a POINTS-PACK PURCHASE
 * (the ledger's own `PackPoints` multiple-of-1,000 requirement), and a
 * per-completion reward (base + accuracy bonus) is a small number that will
 * only ever coincidentally be a multiple of 1,000 — calling `quotePurchase`
 * for it is exactly F61's bug (`ErrNotAPack` on every real reward). Same
 * shape as `quotePurchaseRequestSchema`/`quotePurchaseResultSchema` on
 * purpose (a valuation call must not be distinguishable from a purchase
 * quote by shape, which would let a caller infer something about how each
 * is priced), but a distinct operation because the ledger applies a
 * different validation rule to it.
 */
export const valuePointsRequestSchema = z.object({
  points: pointsSchema,
  region: regionSchema,
});
export type ValuePointsRequest = z.infer<typeof valuePointsRequestSchema>;

export const valuePointsResultSchema = z.object({
  totalMinor: minorUnitsSchema,
  currency: currencySchema,
});
export type ValuePointsResult = z.infer<typeof valuePointsResultSchema>;

/**
 * 14.13 (F122): the region's point packages, each priced by the ledger at
 * P_issue less the tier's discount, rounded up. `undiscountedMinor` is the
 * same points at P_issue, for the saving. Never B: a tier priced below it is
 * left out of the list and refused by quote and purchase.
 */
export const packageTiersRequestSchema = z.object({ region: regionSchema });
export type PackageTiersRequest = z.infer<typeof packageTiersRequestSchema>;

export const packageTierQuoteSchema = z.object({
  tierKey: packageTierKeySchema,
  points: pointsSchema,
  discountBps: z.number().int().min(0).max(10_000),
  totalMinor: minorUnitsSchema,
  undiscountedMinor: minorUnitsSchema,
  currency: currencySchema,
});
export type PackageTierQuote = z.infer<typeof packageTierQuoteSchema>;

export const quotePackageRequestSchema = z.object({
  region: regionSchema,
  tierKey: packageTierKeySchema,
});
export type QuotePackageRequest = z.infer<typeof quotePackageRequestSchema>;

/** Staff's propose and approve ask this before a catalogue is stored or put in force. */
export const checkPackageTiersRequestSchema = z.object({
  region: regionSchema,
  tiers: z.unknown(),
});
export type CheckPackageTiersRequest = z.infer<typeof checkPackageTiersRequestSchema>;
