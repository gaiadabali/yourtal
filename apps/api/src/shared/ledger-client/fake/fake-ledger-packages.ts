import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import {
  PACKAGE_TIERS_SETTING_KEY,
  packageTierCatalogueSchema,
} from "@yourtal/contracts/billing/package-tiers";
import type { PackageTier } from "@yourtal/contracts/billing/package-tiers";
import type {
  CheckPackageTiersRequest,
  PackageTierQuote,
  QuotePackageRequest,
} from "@yourtal/contracts/ledger-internal/pricing";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../persistence/drizzle-client";
import { currentBackingRate, issueMicrosPerPoint } from "./fake-ledger-pricing";

/**
 * 14.13 (F122): the fake's twin of services/ledger/internal/pricing/tiers.go.
 * Same rules: the catalogue is the approved `point_package_tiers` setting, a
 * tier costs ceil(points × P_issue × (10,000 − bps) ÷ 10^10) minor units, and
 * a tier whose price per point is under B is refused (K6).
 */

const BPS = 10_000n;
const SCALE = 1_000_000n * BPS;

interface Rate {
  readonly issue: bigint;
  readonly backing: bigint;
  readonly currency: "AUD" | "IDR";
}

function refused(message: string): LedgerError {
  return ledgerError("refused", message);
}

async function readCatalogue(
  db: AppDb,
  region: string,
): Promise<Result<readonly PackageTier[], LedgerError>> {
  const { rows } = await db.execute<{ value: unknown }>(sql`
    SELECT value FROM platform.region_setting
     WHERE region = ${region} AND key = ${PACKAGE_TIERS_SETTING_KEY}
       AND approved_by IS NOT NULL AND effective_from <= now()
     ORDER BY effective_from DESC LIMIT 1
  `);
  if (rows[0] === undefined) return err(refused(`no package tiers are set for ${region}`));
  const parsed = packageTierCatalogueSchema.safeParse(rows[0].value);
  return parsed.success
    ? ok(parsed.data)
    : err(refused(`the package tier catalogue is not valid: ${parsed.error.message}`));
}

async function rateFor(db: AppDb, region: string): Promise<Result<Rate, LedgerError>> {
  const issue = issueMicrosPerPoint(region);
  if (issue === undefined) return err(ledgerError("region_mismatch", `no rate for ${region}`));
  const rate = await currentBackingRate(db, region, new Date());
  return ok({
    issue,
    backing: BigInt(rate.backing_rate_micros_per_pt),
    currency: region === "AU" ? "AUD" : "IDR",
  });
}

function belowBacking(tier: PackageTier, rate: Rate): boolean {
  return rate.issue * (BPS - BigInt(tier.discountBps)) < rate.backing * BPS;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function quoteTier(tier: PackageTier, rate: Rate): Result<PackageTierQuote, LedgerError> {
  if (belowBacking(tier, rate)) {
    return err(refused(`${tier.key} would sell points below the backing rate`));
  }
  const points = BigInt(tier.points);
  return ok({
    tierKey: tier.key,
    points: toPoints(tier.points),
    discountBps: tier.discountBps,
    totalMinor: toMinorUnits(
      Number(ceilDiv(points * rate.issue * (BPS - BigInt(tier.discountBps)), SCALE)),
    ),
    undiscountedMinor: toMinorUnits(Number(ceilDiv(points * rate.issue, 1_000_000n))),
    currency: rate.currency,
  });
}

/** The tier's price now, read with the catalogue and the rate; `refused` for an unknown or under-B tier. */
export async function priceTier(
  db: AppDb,
  region: string,
  tierKey: string,
): Promise<Result<PackageTierQuote, LedgerError>> {
  const catalogue = await readCatalogue(db, region);
  if (catalogue.isErr()) return err(catalogue.error);
  const rate = await rateFor(db, region);
  if (rate.isErr()) return err(rate.error);
  const tier = catalogue.value.find((entry) => entry.key === tierKey);
  if (tier === undefined) return err(refused(`no package tier ${tierKey} in ${region}`));
  return quoteTier(tier, rate.value);
}

export function quotePackage(
  db: AppDb,
  request: QuotePackageRequest,
): ResultAsync<PackageTierQuote, LedgerError> {
  return new ResultAsync(priceTier(db, request.region, request.tierKey));
}

/** Every tier on sale; one under B is left out, as the real ledger does. */
export function packageTiers(
  db: AppDb,
  region: Region,
): ResultAsync<readonly PackageTierQuote[], LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<readonly PackageTierQuote[], LedgerError>> => {
      const catalogue = await readCatalogue(db, region);
      if (catalogue.isErr()) return err(catalogue.error);
      const rate = await rateFor(db, region);
      if (rate.isErr()) return err(rate.error);
      const quotes: PackageTierQuote[] = [];
      for (const tier of catalogue.value) {
        const quoted = quoteTier(tier, rate.value);
        if (quoted.isOk()) quotes.push(quoted.value);
      }
      return ok(quotes);
    })(),
  );
}

export function checkPackageTiers(
  db: AppDb,
  request: CheckPackageTiersRequest,
): ResultAsync<void, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<void, LedgerError>> => {
      const parsed = packageTierCatalogueSchema.safeParse(request.tiers);
      if (!parsed.success) {
        return err(refused(`the package tier catalogue is not valid: ${parsed.error.message}`));
      }
      const rate = await rateFor(db, request.region);
      if (rate.isErr()) return err(rate.error);
      const under = parsed.data.find((tier) => belowBacking(tier, rate.value));
      return under === undefined
        ? ok(undefined)
        : err(refused(`${under.key} would sell points below the backing rate`));
    })(),
  );
}
