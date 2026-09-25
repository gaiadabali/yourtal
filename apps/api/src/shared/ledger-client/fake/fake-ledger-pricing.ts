import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, errAsync, ok, okAsync } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import type {
  LockQuoteRequest,
  PriceListingRequest,
  PriceListingResult,
  Quote,
  QuotePurchaseRequest,
  QuotePurchaseResult,
  QuoteRequest,
} from "@yourtal/contracts/ledger-internal/pricing";
import type { AppDb } from "../../persistence/drizzle-client";

/** F10/F1's launch multiplier: pinned at 1.0 (10,000 bps) — YT-0130. */
const DEMAND_MULTIPLIER_BPS = 10_000;
const QUOTE_TTL_MS = 15 * 60 * 1000;

/**
 * F12's fixed points-pack prices (P_issue, never B): AU 1,000 pts = AUD 45.00,
 * ID 1,000 pts = IDR 9,000. A constant here until 1.2.f's `region_setting`
 * makes it configurable, the same handoff `rewards.ts`'s holdback table notes.
 */
const PACK_PRICE_MINOR_PER_1000_POINTS: Readonly<Record<string, number>> = {
  AU: 4_500,
  ID: 9_000,
};

type BackingRateRow = {
  readonly id: string;
  readonly region: string;
  readonly currency: string;
  readonly backing_rate_micros_per_pt: string;
};

async function currentBackingRate(db: AppDb, region: string, at: Date): Promise<BackingRateRow> {
  const result = await db.execute<BackingRateRow>(sql`
    SELECT id, region, currency, backing_rate_micros_per_pt
      FROM platform.ledger_fake_backing_rate
     WHERE region = ${region} AND effective_from <= ${at.toISOString()}
     ORDER BY effective_from DESC
     LIMIT 1
  `);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`no backing rate is in force for region ${region} at ${at.toISOString()}`);
  }
  return row;
}

/** `ceil(settlementMinor * 1e6 / backingRateMicros)` in exact integer arithmetic — TASKS.md 1.2.d. */
function priceInPoints(settlementMinor: number, backingRateMicros: bigint): bigint {
  const numerator = BigInt(settlementMinor) * 1_000_000n;
  return (numerator + backingRateMicros - 1n) / backingRateMicros;
}

export function quote(db: AppDb, request: QuoteRequest): ResultAsync<Quote, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Quote, LedgerError>> => {
      const at = request.at !== undefined ? new Date(request.at) : new Date();
      const rate = await currentBackingRate(db, request.region, at);
      if (rate.currency !== request.currency) {
        return err(
          ledgerError(
            "currency_mismatch",
            `region ${request.region} prices in ${rate.currency}, not ${request.currency}`,
          ),
        );
      }
      const pricePoints = priceInPoints(
        request.settlementMinor,
        BigInt(rate.backing_rate_micros_per_pt),
      );
      const now = new Date();
      const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS);
      const id = randomUUID();
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_quote
          (id, region, currency, settlement_minor, price_points, backing_rate_id,
           demand_multiplier_bps, expires_at)
        VALUES (${id}, ${request.region}, ${request.currency}, ${request.settlementMinor},
                ${pricePoints.toString()}, ${rate.id}, ${DEMAND_MULTIPLIER_BPS}, ${expiresAt.toISOString()})
      `);
      return ok({
        quoteId: id,
        pricePoints: toPoints(Number(pricePoints)),
        settlementMinor: request.settlementMinor,
        currency: request.currency,
        backingRateId: rate.id,
        demandMultiplierBps: DEMAND_MULTIPLIER_BPS,
        expiresAt: expiresAt.toISOString(),
        locked: false,
      });
    })(),
  );
}

type QuoteRow = {
  readonly id: string;
  readonly region: string;
  readonly currency: string;
  readonly settlement_minor: string;
  readonly price_points: string;
  readonly backing_rate_id: string;
  readonly demand_multiplier_bps: number;
  readonly expires_at: string;
  readonly locked: boolean;
};

function toQuote(row: QuoteRow): Quote {
  return {
    quoteId: row.id,
    pricePoints: toPoints(Number(row.price_points)),
    settlementMinor: toMinorUnits(Number(row.settlement_minor)),
    currency: row.currency as Quote["currency"],
    backingRateId: row.backing_rate_id,
    demandMultiplierBps: row.demand_multiplier_bps,
    expiresAt: new Date(row.expires_at).toISOString(),
    locked: row.locked,
  };
}

/** Locking a quote freezes its price against a later rate change — it does NOT extend `expiresAt`. */
export function lockQuote(db: AppDb, request: LockQuoteRequest): ResultAsync<Quote, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Quote, LedgerError>> => {
      const result = await db.execute<QuoteRow>(sql`
        SELECT id, region, currency, settlement_minor, price_points, backing_rate_id,
               demand_multiplier_bps, expires_at, locked
          FROM platform.ledger_fake_quote WHERE id = ${request.quoteId}
      `);
      const row = result.rows[0];
      if (row === undefined) {
        return err(ledgerError("quote_expired", `no quote ${request.quoteId} exists`));
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return err(ledgerError("quote_expired", `quote ${request.quoteId} has expired`));
      }
      await db.execute(
        sql`UPDATE platform.ledger_fake_quote SET locked = true WHERE id = ${request.quoteId}`,
      );
      return ok(toQuote({ ...row, locked: true }));
    })(),
  );
}

export function priceListing(
  db: AppDb,
  request: PriceListingRequest,
): ResultAsync<PriceListingResult, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<PriceListingResult, LedgerError>> => {
      const rate = await currentBackingRate(db, request.region, new Date());
      if (rate.currency !== request.currency) {
        return err(
          ledgerError(
            "currency_mismatch",
            `region ${request.region} prices in ${rate.currency}, not ${request.currency}`,
          ),
        );
      }
      const pricePoints = priceInPoints(
        request.settlementMinor,
        BigInt(rate.backing_rate_micros_per_pt),
      );
      return ok({ pricePoints: toPoints(Number(pricePoints)), backingRateId: rate.id });
    })(),
  );
}

export function quotePurchase(
  request: QuotePurchaseRequest,
): ResultAsync<QuotePurchaseResult, LedgerError> {
  const packPriceMinor = PACK_PRICE_MINOR_PER_1000_POINTS[request.region];
  if (packPriceMinor === undefined) {
    return errAsync(
      ledgerError("region_mismatch", `no points-pack price for region ${request.region}`),
    );
  }
  const totalMinor = toMinorUnits(Math.ceil((request.points * packPriceMinor) / 1_000));
  const currency = request.region === "AU" ? "AUD" : "IDR";
  return okAsync({ totalMinor, currency });
}
