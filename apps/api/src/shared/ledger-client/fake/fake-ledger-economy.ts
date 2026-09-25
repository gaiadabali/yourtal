import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import type {
  ApprovePayoutRequest,
  ApproveRateRequest,
  Coverage,
  EconomyDailyRequest,
  EconomyDayRow,
  FundMarketingRequest,
  ProposeRateRequest,
  RateProposal,
  StatementsRequest,
} from "@yourtal/contracts/ledger-internal/economy";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * TASKS.md 1.2.a's economy group. Illustrative arithmetic, not the real
 * double-entry books Phase 4 builds: `pointsOutstanding` sums unreversed
 * grants for the region and does not subtract burns (a burn does not carry
 * its region here, so this is a conservative over-count, not a wrong sign) —
 * good enough for B/C to build a coverage dashboard against, not a claim
 * about actual solvency.
 */
export function coverage(db: AppDb, region: string): ResultAsync<Coverage, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Coverage, LedgerError>> => {
      const rateRows = await db.execute<{ backing_rate_micros_per_pt: string }>(sql`
        SELECT backing_rate_micros_per_pt FROM platform.ledger_fake_backing_rate
         WHERE region = ${region} ORDER BY effective_from DESC LIMIT 1
      `);
      const rate = rateRows.rows[0];
      if (rate === undefined) {
        return err(ledgerError("region_mismatch", `no backing rate is in force for region ${region}`));
      }
      const reserveRows = await db.execute<{ reserve: string }>(sql`
        SELECT COALESCE(SUM(paid_minor), 0) AS reserve FROM platform.ledger_fake_point_purchase
         WHERE region = ${region}
      `);
      const outstandingRows = await db.execute<{ outstanding: string }>(sql`
        SELECT COALESCE(SUM(points), 0) AS outstanding FROM platform.ledger_fake_grant
         WHERE region = ${region} AND NOT reversed
      `);
      const reserveMinor = Number(reserveRows.rows[0]?.reserve ?? 0);
      const pointsOutstanding = Number(outstandingRows.rows[0]?.outstanding ?? 0);
      const backingRateMicros = Number(rate.backing_rate_micros_per_pt);
      const outstandingValueMinor = (pointsOutstanding * backingRateMicros) / 1_000_000;
      const ratio = outstandingValueMinor === 0 ? 1 : reserveMinor / outstandingValueMinor;
      return ok({
        region: region as Coverage["region"],
        ratio,
        reserveMinor: toMinorUnits(reserveMinor),
        pointsOutstanding: toPoints(pointsOutstanding),
        asOf: new Date().toISOString(),
      });
    })(),
  );
}

export function economyDaily(
  db: AppDb,
  request: EconomyDailyRequest,
): ResultAsync<readonly EconomyDayRow[], LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<readonly EconomyDayRow[], LedgerError>> => {
      const issuedRows = await db.execute<{ day: string; issued: string }>(sql`
        SELECT to_char(granted_at, 'YYYY-MM-DD') AS day, SUM(points) AS issued
          FROM platform.ledger_fake_grant
         WHERE region = ${request.region} AND NOT reversed
           AND granted_at::date BETWEEN ${request.from}::date AND ${request.to}::date
         GROUP BY day ORDER BY day
      `);
      const reserveRows = await db.execute<{ reserve: string }>(sql`
        SELECT COALESCE(SUM(paid_minor), 0) AS reserve FROM platform.ledger_fake_point_purchase
         WHERE region = ${request.region}
      `);
      const reserveMinor = Number(reserveRows.rows[0]?.reserve ?? 0);
      return ok(
        issuedRows.rows.map(
          (row): EconomyDayRow => ({
            date: row.day,
            region: request.region as EconomyDayRow["region"],
            pointsIssued: toPoints(Number(row.issued)),
            // Burns are not region-tagged in this fake (see the module comment).
            pointsRedeemed: toPoints(0),
            reserveMinor: toMinorUnits(reserveMinor),
          }),
        ),
      );
    })(),
  );
}

type RateProposalRow = {
  readonly id: string;
  readonly region: string;
  readonly backing_rate_micros_per_pt: string;
  readonly proposed_by: string;
  readonly approved_by: string | null;
  readonly state: string;
}

function toRateProposal(row: RateProposalRow): RateProposal {
  return {
    proposalId: row.id,
    region: row.region as RateProposal["region"],
    backingRateMicrosPerPoint: Number(row.backing_rate_micros_per_pt),
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    state: row.state as RateProposal["state"],
  };
}

export function proposeRate(
  db: AppDb,
  request: ProposeRateRequest,
): ResultAsync<RateProposal, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<RateProposal, LedgerError>> => {
      const id = randomUUID();
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_rate_proposal
          (id, region, currency, backing_rate_micros_per_pt, proposed_by)
        VALUES (${id}, ${request.region}, ${request.currency}, ${request.backingRateMicrosPerPoint}, ${request.proposedBy})
      `);
      return ok({
        proposalId: id,
        region: request.region,
        backingRateMicrosPerPoint: request.backingRateMicrosPerPoint,
        proposedBy: request.proposedBy,
        approvedBy: null,
        state: "pending",
      });
    })(),
  );
}

/** Two-person approval (9.5): `approvedBy` must differ from `proposedBy`, enforced by a CHECK too. */
export function approveRate(
  db: AppDb,
  request: ApproveRateRequest,
): ResultAsync<RateProposal, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<RateProposal, LedgerError>> => {
      const rows = await db.execute<RateProposalRow>(sql`
        SELECT id, region, backing_rate_micros_per_pt, proposed_by, approved_by, state
          FROM platform.ledger_fake_rate_proposal WHERE id = ${request.proposalId}
      `);
      const row = rows.rows[0];
      if (row === undefined) throw new Error(`no rate proposal ${request.proposalId} exists`);
      if (row.proposed_by === request.approvedBy) {
        return err(
          ledgerError("already_granted", "a rate proposal cannot be approved by its own proposer"),
        );
      }
      if (row.state === "approved") return ok(toRateProposal(row));

      await db.execute(sql`
        UPDATE platform.ledger_fake_rate_proposal SET approved_by = ${request.approvedBy}, state = 'approved'
         WHERE id = ${request.proposalId}
      `);
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_backing_rate (region, currency, backing_rate_micros_per_pt)
        SELECT region, currency, backing_rate_micros_per_pt FROM platform.ledger_fake_rate_proposal
         WHERE id = ${request.proposalId}
      `);
      return ok(toRateProposal({ ...row, approved_by: request.approvedBy, state: "approved" }));
    })(),
  );
}

export function fundMarketing(
  db: AppDb,
  request: FundMarketingRequest,
): ResultAsync<void, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<void, LedgerError>> => {
      if (request.proposedBy === request.approvedBy) {
        return err(
          ledgerError("already_granted", "marketing funding cannot be approved by its own proposer"),
        );
      }
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_marketing_fund (region, amount_minor, proposed_by, approved_by)
        VALUES (${request.region}, ${request.amountMinor}, ${request.proposedBy}, ${request.approvedBy})
      `);
      return ok(undefined);
    })(),
  );
}

/**
 * Until 10.1 (TASKS.md 1.2.d). Deliberately NOT one of 1.2.c's twelve closed
 * `LedgerError` codes — none of them mean "not built yet", and reusing one
 * (say `kill_switch`) would tell a caller the wrong story about why. This
 * throws, the same way `services/ledger/internal/api/routes.go`'s
 * `notYetExposed` answers with a 501 rather than a business-rule 4xx.
 */
export function statements(_request: StatementsRequest): ResultAsync<never, LedgerError> {
  return new ResultAsync(Promise.reject(new Error("statements are not implemented until 10.1")));
}

/** Until 10.1. Same reasoning as `statements` above. */
export function approvePayout(_request: ApprovePayoutRequest): ResultAsync<never, LedgerError> {
  return new ResultAsync(Promise.reject(new Error("payout approval is not implemented until 10.1")));
}
