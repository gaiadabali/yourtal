import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toPoints } from "@yourtal/contracts/money";
import type { Points } from "@yourtal/contracts/money";
import {
  DEFAULT_HOLDBACK_HOURS_BY_TIER,
  type AgeBand,
  type Burn,
  type BurnForVoucherRequest,
  type Grant,
  type GrantActionRequest,
  type GrantRewardRequest,
} from "@yourtal/contracts/ledger-internal/rewards";
import { REGION_TIMEZONE } from "@yourtal/contracts/me/streak";
import type { AppDb } from "../../persistence/drizzle-client";
import { LedgerNotFoundError } from "../ledger-not-found";
import { availablePoints } from "./fake-ledger-balance";

/**
 * 12.1.c: the teen half of F12's earn cap, so fake-mode e2e refuses a
 * teen's grant the same way the real Go ledger's `reward.Engine.checkCaps`
 * does. Deliberately narrow — the fake has never enforced the ADULT daily
 * or monthly caps either (a pre-existing gap this task did not open), so
 * this checks only `ageBand === "teen"` against `teen_daily_earn_cap`, read
 * with a direct query rather than through `DrizzleRegionSettingsReader`:
 * `grantAction`'s own check must run inside its transaction (`tx`, not the
 * outer `db` that class is typed for), so plain SQL avoids a type mismatch
 * for one query in exchange for a second copy of "read the current
 * setting" (the same shape `apps/worker`'s `streak-backstop.ts` already
 * accepts for the same reason).
 */
async function teenCapRefusal(
  executor: Pick<AppDb, "execute">,
  request: { userId: string; region: "AU" | "ID"; points: number; ageBand?: AgeBand | undefined },
): Promise<LedgerError | null> {
  if (request.ageBand !== "teen") return null;

  const capRows = await executor.execute<{ value: unknown }>(sql`
    SELECT value FROM platform.region_setting
     WHERE region = ${request.region} AND key = 'teen_daily_earn_cap'
       AND approved_by IS NOT NULL AND effective_from <= now()
     ORDER BY effective_from DESC LIMIT 1
  `);
  const cap = capRows.rows[0]?.value;
  if (typeof cap !== "number") {
    return ledgerError(
      "velocity_capped",
      `no teen_daily_earn_cap is configured for ${request.region}`,
    );
  }

  const tz = REGION_TIMEZONE[request.region];
  const earnedRows = await executor.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(points), 0) AS total
      FROM platform.ledger_fake_grant
     WHERE user_id = ${request.userId} AND region = ${request.region}
       AND granted_at >= (date_trunc('day', now() AT TIME ZONE ${tz})) AT TIME ZONE ${tz}
  `);
  const earned = Number(earnedRows.rows[0]?.total ?? 0);
  if (earned + request.points > cap) {
    return ledgerError(
      "velocity_capped",
      `${String(earned)} + ${String(request.points)} over the teen daily cap of ${String(cap)} for ${request.region}`,
    );
  }
  return null;
}

type GrantRow = {
  readonly id: string;
  readonly kind: string;
  readonly user_id: string;
  readonly region: string;
  readonly points: string;
  readonly unlock_at: string;
  readonly granted_at: string;
  readonly idempotency_key: string;
};

function toGrant(row: GrantRow): Grant {
  return {
    grantId: row.id,
    kind: row.kind as Grant["kind"],
    userId: row.user_id,
    region: row.region as Grant["region"],
    points: toPoints(Number(row.points)),
    unlockAt: new Date(row.unlock_at).toISOString(),
    grantedAt: new Date(row.granted_at).toISOString(),
  };
}

async function insertGrant(
  db: AppDb,
  kind: Grant["kind"],
  campaignId: string | null,
  request: {
    userId: string;
    region: string;
    points: Points;
    trustTier: 0 | 1 | 2 | 3;
    idempotencyKey: string;
    ageBand?: AgeBand | undefined;
  },
): Promise<Result<Grant, LedgerError>> {
  const existing = await db.execute<GrantRow>(sql`
    SELECT id, kind, user_id, region, points, unlock_at, granted_at, idempotency_key
      FROM platform.ledger_fake_grant WHERE idempotency_key = ${request.idempotencyKey}
  `);
  const prior = existing.rows[0];
  if (prior !== undefined) {
    const matches =
      prior.kind === kind &&
      prior.user_id === request.userId &&
      Number(prior.points) === request.points;
    if (!matches) {
      return err(
        ledgerError(
          "idempotency_conflict",
          `idempotency key ${request.idempotencyKey} was already used for a different grant`,
        ),
      );
    }
    return ok(toGrant(prior));
  }

  const refusal = await teenCapRefusal(db, {
    userId: request.userId,
    region: request.region as "AU" | "ID",
    points: request.points,
    ageBand: request.ageBand,
  });
  if (refusal !== null) return err(refusal);

  const id = randomUUID();
  const holdbackHours = DEFAULT_HOLDBACK_HOURS_BY_TIER[request.trustTier];
  // The database's clock, not this process's: balance compares unlock_at with
  // now(), and a host clock a few ms ahead makes an instant grant look held.
  const inserted = await db.execute<{ granted_at: string | Date; unlock_at: string | Date }>(sql`
    INSERT INTO platform.ledger_fake_grant
      (id, kind, user_id, region, points, unlock_at, granted_at, idempotency_key, campaign_id)
    VALUES (${id}, ${kind}, ${request.userId}, ${request.region}, ${request.points},
            now() + make_interval(hours => ${holdbackHours}), now(), ${request.idempotencyKey}, ${campaignId})
    RETURNING granted_at, unlock_at
  `);
  const row = inserted.rows[0];
  if (row === undefined) throw new Error("the fake grant insert returned no row");
  const grantedAt = new Date(row.granted_at);
  const unlockAt = new Date(row.unlock_at);
  return ok({
    grantId: id,
    kind,
    userId: request.userId,
    region: request.region as Grant["region"],
    points: request.points,
    unlockAt: unlockAt.toISOString(),
    grantedAt: grantedAt.toISOString(),
  });
}

export function grantReward(
  db: AppDb,
  request: GrantRewardRequest,
): ResultAsync<Grant, LedgerError> {
  return new ResultAsync(insertGrant(db, "campaign", request.campaignId, request));
}

/**
 * 10.7.a, K6 (4.4.h, F24): every `grantAction` kind (streak, receipt,
 * goodwill) is marketing-funded, never a partner's allocation — the same
 * rule services/ledger's `backMarketingGrant` enforces for real. `backing`
 * (ceil(points × B), B the region's current backing rate) is debited from
 * the region's marketing fund in the SAME transaction as the grant, and a
 * grant the fund cannot back is refused with `insufficient_available` —
 * services/ledger's own overdraft guard answers the same code for the same
 * reason (k6_test.go's `TestAMarketingGrantLargerThanMarketingCashIsRefused`).
 */
export function grantAction(
  db: AppDb,
  request: GrantActionRequest,
): ResultAsync<Grant, LedgerError> {
  return new ResultAsync(
    db.transaction(async (tx): Promise<Result<Grant, LedgerError>> => {
      // The idempotency check runs INSIDE the transaction now: a replay
      // must not also debit the marketing fund a second time.
      const existing = await tx.execute<GrantRow>(sql`
        SELECT id, kind, user_id, region, points, unlock_at, granted_at, idempotency_key
          FROM platform.ledger_fake_grant WHERE idempotency_key = ${request.idempotencyKey}
      `);
      const prior = existing.rows[0];
      if (prior !== undefined) {
        const matches =
          prior.kind === request.kind &&
          prior.user_id === request.userId &&
          Number(prior.points) === request.points;
        if (!matches) {
          return err(
            ledgerError(
              "idempotency_conflict",
              `idempotency key ${request.idempotencyKey} was already used for a different grant`,
            ),
          );
        }
        return ok(toGrant(prior));
      }

      const refusal = await teenCapRefusal(tx, {
        userId: request.userId,
        region: request.region,
        points: request.points,
        ageBand: request.ageBand,
      });
      if (refusal !== null) return err(refusal);

      const rateRows = await tx.execute<{ backing_rate_micros_per_pt: string }>(sql`
        SELECT backing_rate_micros_per_pt FROM platform.ledger_fake_backing_rate
         WHERE region = ${request.region} ORDER BY effective_from DESC LIMIT 1
      `);
      const rate = rateRows.rows[0];
      if (rate === undefined) {
        return err(
          ledgerError(
            "region_mismatch",
            `no backing rate is in force for region ${request.region}`,
          ),
        );
      }
      const backingMinor = Math.ceil(
        (request.points * Number(rate.backing_rate_micros_per_pt)) / 1_000_000,
      );

      // FOR UPDATE on the underlying rows, not an aggregate (Postgres
      // refuses FOR UPDATE together with an aggregate/GROUP BY) — this
      // serialises two concurrent grants against the same region's
      // marketing cash so neither reads "remaining" before the other's debit.
      const fundRows = await tx.execute<{ amount_minor: string }>(sql`
        SELECT amount_minor FROM platform.ledger_fake_marketing_fund
         WHERE region = ${request.region} FOR UPDATE
      `);
      const backingRows = await tx.execute<{ amount_minor: string }>(sql`
        SELECT amount_minor FROM platform.ledger_fake_marketing_backing
         WHERE region = ${request.region} FOR UPDATE
      `);
      const funded = fundRows.rows.reduce((sum, row) => sum + Number(row.amount_minor), 0);
      const backed = backingRows.rows.reduce((sum, row) => sum + Number(row.amount_minor), 0);
      const remaining = funded - backed;
      if (backingMinor > remaining) {
        return err(
          ledgerError(
            "insufficient_available",
            `${request.region} marketing cash has ${String(remaining)} minor remaining, ` +
              `this grant needs ${String(backingMinor)}`,
          ),
        );
      }

      const id = randomUUID();
      const holdbackHours = DEFAULT_HOLDBACK_HOURS_BY_TIER[request.trustTier];
      const inserted = await tx.execute<{
        granted_at: string | Date;
        unlock_at: string | Date;
      }>(sql`
        INSERT INTO platform.ledger_fake_grant
          (id, kind, user_id, region, points, unlock_at, granted_at, idempotency_key, campaign_id)
        VALUES (${id}, ${request.kind}, ${request.userId}, ${request.region}, ${request.points},
                now() + make_interval(hours => ${holdbackHours}), now(), ${request.idempotencyKey}, NULL)
        RETURNING granted_at, unlock_at
      `);
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("the fake grant insert returned no row");

      await tx.execute(sql`
        INSERT INTO platform.ledger_fake_marketing_backing (region, grant_id, amount_minor)
        VALUES (${request.region}, ${id}, ${backingMinor})
      `);

      return ok({
        grantId: id,
        kind: request.kind,
        userId: request.userId,
        region: request.region,
        points: request.points,
        unlockAt: new Date(row.unlock_at).toISOString(),
        grantedAt: new Date(row.granted_at).toISOString(),
      });
    }),
  );
}

type BurnRow = {
  readonly saga_id: string;
  readonly user_id: string;
  readonly listing_id: string;
  readonly points: string;
  readonly state: string;
  readonly burned_at: string;
  readonly region: string | null;
};

/**
 * 10.7.b: the region a burn's points came from, for economyDaily's
 * pointsRedeemed — looked up from the SAME app database's own
 * `store.listings` (BurnForVoucherRequest carries no region of its own; a
 * listing's region is denormalised the same way voucher.vouchers.region is,
 * 4.5.e). A listing this fixture never inserted (rare, test-only) leaves
 * the burn's region NULL rather than refusing the burn over it — the same
 * "nullable, nothing reads old rows as AU or ID" choice ledger.allocation's
 * own region column makes.
 */
async function listingRegion(db: AppDb, listingId: string): Promise<string | null> {
  const rows = await db.execute<{ region: string }>(sql`
    SELECT region FROM store.listings WHERE id = ${listingId}
  `);
  return rows.rows[0]?.region ?? null;
}

function toBurn(row: BurnRow): Burn {
  return {
    sagaId: row.saga_id,
    userId: row.user_id,
    listingId: row.listing_id,
    points: toPoints(Number(row.points)),
    state: row.state as Burn["state"],
    burnedAt: new Date(row.burned_at).toISOString(),
  };
}

/** Draws from AVAILABLE only (TASKS.md 1.2.d) — see `fake-ledger-balance.ts`. */
export function burnForVoucher(
  db: AppDb,
  request: BurnForVoucherRequest,
): ResultAsync<Burn, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Burn, LedgerError>> => {
      const existing = await db.execute<BurnRow>(sql`
        SELECT saga_id, user_id, listing_id, points, state, burned_at, region
          FROM platform.ledger_fake_burn WHERE saga_id = ${request.sagaId}
      `);
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (prior.user_id !== request.userId || Number(prior.points) !== request.points) {
          return err(
            ledgerError(
              "idempotency_conflict",
              `saga ${request.sagaId} was already used for a different burn`,
            ),
          );
        }
        return ok(toBurn(prior));
      }

      if (request.quoteId !== undefined) {
        const quotes = await db.execute<{
          price_points: string;
          locked: boolean;
          live: boolean;
        }>(sql`
          SELECT price_points, locked, expires_at > now() AS live
            FROM platform.ledger_fake_quote WHERE id = ${request.quoteId}
        `);
        const quote = quotes.rows[0];
        if (
          quote?.locked !== true ||
          !quote.live ||
          Number(quote.price_points) !== request.points
        ) {
          return err(
            ledgerError("quote_expired", `quote ${request.quoteId} does not hold this price`),
          );
        }
      }

      const available = await availablePoints(db, request.userId);
      if (available < request.points) {
        return err(
          ledgerError(
            "insufficient_available",
            `user ${request.userId} has ${String(available)} available, needs ${String(request.points)}`,
          ),
        );
      }

      const region = await listingRegion(db, request.listingId);
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_burn (saga_id, user_id, listing_id, points, region)
        VALUES (${request.sagaId}, ${request.userId}, ${request.listingId}, ${request.points}, ${region})
      `);
      return ok({
        sagaId: request.sagaId,
        userId: request.userId,
        listingId: request.listingId,
        points: request.points,
        state: "burned",
        burnedAt: new Date().toISOString(),
      });
    })(),
  );
}

async function loadBurn(db: AppDb, sagaId: string): Promise<BurnRow> {
  const result = await db.execute<BurnRow>(sql`
    SELECT saga_id, user_id, listing_id, points, state, burned_at, region
      FROM platform.ledger_fake_burn WHERE saga_id = ${sagaId}
  `);
  const row = result.rows[0];
  if (row === undefined) throw new LedgerNotFoundError(`no burn ${sagaId} exists`);
  return row;
}

export function getBurn(db: AppDb, sagaId: string): ResultAsync<Burn, LedgerError> {
  return new ResultAsync(loadBurn(db, sagaId).then((row) => ok(toBurn(row))));
}

/** K13: reverses a burn that failed downstream (e.g. voucher issuance never completed). */
export function reinstateBurn(db: AppDb, sagaId: string): ResultAsync<Burn, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Burn, LedgerError>> => {
      const row = await loadBurn(db, sagaId);
      if (row.state === "reinstated") return ok(toBurn(row));
      await db.execute(
        sql`UPDATE platform.ledger_fake_burn SET state = 'reinstated' WHERE saga_id = ${sagaId}`,
      );
      return ok(toBurn({ ...row, state: "reinstated" }));
    })(),
  );
}
