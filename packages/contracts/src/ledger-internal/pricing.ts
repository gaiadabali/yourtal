import { z } from "zod";
import { minorUnitsSchema, pointsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";

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
