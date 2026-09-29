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
  DisputeStatementRequest,
  EconomyDailyRequest,
  EconomyDayRow,
  FundMarketingRequest,
  GenerateStatementRequest,
  ProposeRateRequest,
  RateProposal,
  ReleaseVoucherLiabilityRequest,
  ResolveStatementDisputeRequest,
  Statement,
  StatementsRequest,
} from "@yourtal/contracts/ledger-internal/economy";
import type { AppDb } from "../../persistence/drizzle-client";

/** DisputeWindowDays is F12's "Settlement | Dispute window 7 days" (services/ledger/internal/settlement's own constant, mirrored here). */
const DISPUTE_WINDOW_DAYS = 7;

/**
 * TASKS.md 1.2.a's economy group. Illustrative arithmetic, not the real
 * double-entry books Phase 4 builds: `pointsOutstanding` sums unreversed
 * grants for the region and does not subtract burns (10.7 region-tags
 * burns for `economyDaily`'s own `pointsRedeemed` below, but does not wire
 * that into THIS function's own outstanding figure — a deliberately
 * separate, smaller change; this stays a conservative over-count, not a
 * wrong sign) — good enough for B/C to build a coverage dashboard against,
 * not a claim about actual solvency.
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
        return err(
          ledgerError("region_mismatch", `no backing rate is in force for region ${region}`),
        );
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
      const nothingOwed = outstandingValueMinor === 0;
      const ratio = nothingOwed ? 0 : reserveMinor / outstandingValueMinor;
      return ok({
        region: region as Coverage["region"],
        ratio,
        reserveMinor: toMinorUnits(reserveMinor),
        pointsOutstanding: toPoints(pointsOutstanding),
        asOf: new Date().toISOString(),
        nothingOwed,
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
      // 10.7.b: region-tagged now (fake-ledger-rewards.ts's burnForVoucher
      // looks the region up from store.listings) — `state = 'burned'`
      // excludes a K13 reinstatement, whose points are no longer redeemed,
      // the same way `NOT reversed` excludes a reversed grant above.
      const burnedRows = await db.execute<{ day: string; burned: string }>(sql`
        SELECT to_char(burned_at, 'YYYY-MM-DD') AS day, SUM(points) AS burned
          FROM platform.ledger_fake_burn
         WHERE region = ${request.region} AND state = 'burned'
           AND burned_at::date BETWEEN ${request.from}::date AND ${request.to}::date
         GROUP BY day
      `);
      const reserveRows = await db.execute<{ reserve: string }>(sql`
        SELECT COALESCE(SUM(paid_minor), 0) AS reserve FROM platform.ledger_fake_point_purchase
         WHERE region = ${request.region}
      `);
      const reserveMinor = Number(reserveRows.rows[0]?.reserve ?? 0);

      const byDay = new Map<string, { issued: number; burned: number }>();
      for (const row of issuedRows.rows) {
        byDay.set(row.day, { issued: Number(row.issued), burned: 0 });
      }
      for (const row of burnedRows.rows) {
        const existing = byDay.get(row.day);
        if (existing !== undefined) existing.burned = Number(row.burned);
        else byDay.set(row.day, { issued: 0, burned: Number(row.burned) });
      }

      return ok(
        [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([day, totals]): EconomyDayRow => ({
              date: day,
              region: request.region,
              pointsIssued: toPoints(totals.issued),
              pointsRedeemed: toPoints(totals.burned),
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
};

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
          ledgerError(
            "already_granted",
            "marketing funding cannot be approved by its own proposer",
          ),
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

type StatementRow = {
  readonly id: string;
  readonly business_id: string;
  readonly region: string;
  readonly currency: string;
  readonly period_from: string;
  readonly period_to: string;
  readonly opening_payable_minor: string;
  readonly captures_minor: string;
  readonly refunds_minor: string;
  readonly recoveries_minor: string;
  readonly closing_payable_minor: string;
  readonly point_purchases_minor: string;
  readonly point_purchases_points: string;
  readonly status: string;
  readonly dispute_reason: string | null;
  readonly disputed_at: string | null;
  readonly resolution_note: string | null;
  readonly resolved_at: string | null;
  readonly dispute_window_ends_at: string;
  readonly generated_at: string;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly payout_transfer_id: string | null;
};

function toStatement(row: StatementRow): Statement {
  return {
    id: row.id,
    businessId: row.business_id,
    region: row.region as Statement["region"],
    currency: row.currency as Statement["currency"],
    periodFrom: new Date(row.period_from).toISOString(),
    periodTo: new Date(row.period_to).toISOString(),
    openingPayableMinor: Number(row.opening_payable_minor),
    capturesMinor: toMinorUnits(Number(row.captures_minor)),
    refundsMinor: toMinorUnits(Number(row.refunds_minor)),
    recoveriesMinor: toMinorUnits(Number(row.recoveries_minor)),
    closingPayableMinor: Number(row.closing_payable_minor),
    pointPurchasesMinor: toMinorUnits(Number(row.point_purchases_minor)),
    pointPurchasesPoints: toPoints(Number(row.point_purchases_points)),
    status: row.status as Statement["status"],
    disputeReason: row.dispute_reason,
    disputedAt: row.disputed_at === null ? null : new Date(row.disputed_at).toISOString(),
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
    disputeWindowEndsAt: new Date(row.dispute_window_ends_at).toISOString(),
    generatedAt: new Date(row.generated_at).toISOString(),
    approvedBy: row.approved_by,
    approvedAt: row.approved_at === null ? null : new Date(row.approved_at).toISOString(),
    payoutTransferId: row.payout_transfer_id,
  };
}

const statementColumns = sql`id, business_id, region, currency, period_from, period_to,
  opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
  closing_payable_minor, point_purchases_minor, point_purchases_points,
  status, dispute_reason, disputed_at, resolution_note, resolved_at,
  dispute_window_ends_at, generated_at, approved_by, approved_at, payout_transfer_id`;

/**
 * Not part of `LedgerInternalClient` — apps/worker's real weekly job talks
 * to the real ledger's own worker-only route (it is the one caller that
 * knows a business's region without inferring it); this is that same
 * computation against the fake store, for seed scripts and tests that need
 * a statement to exist under `LEDGER_MODE=fake` without a real ledger
 * running. Mirrors services/ledger/internal/settlement's own compute(): opening is
 * the account's balance strictly before `from`; closing is opening + the
 * account's true net movement in [from, to); captures/refunds/recoveries are
 * that movement's human-readable breakdown.
 */
export async function generateStatementFake(
  db: AppDb,
  request: GenerateStatementRequest,
): Promise<Statement> {
  const existing = await db.execute<StatementRow>(sql`
    SELECT ${statementColumns} FROM platform.ledger_fake_statement
     WHERE business_id = ${request.businessId} AND region = ${request.region}
       AND period_from = ${request.from}::timestamptz AND period_to = ${request.to}::timestamptz
  `);
  if (existing.rows[0] !== undefined) return toStatement(existing.rows[0]);

  const openingRows = await db.execute<{ opening: string }>(sql`
    SELECT COALESCE(SUM(amount_minor), 0) AS opening FROM platform.ledger_fake_capture
     WHERE merchant_id = ${request.businessId} AND region = ${request.region} AND posted_at < ${request.from}::timestamptz
  `);
  const capturesRows = await db.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(amount_minor), 0) AS total FROM platform.ledger_fake_capture
     WHERE merchant_id = ${request.businessId} AND region = ${request.region}
       AND posted_at >= ${request.from}::timestamptz AND posted_at < ${request.to}::timestamptz
  `);
  const recoveriesRows = await db.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(r.amount_minor), 0) AS total FROM platform.ledger_fake_capture_recovery r
     WHERE r.merchant_id = ${request.businessId} AND r.region = ${request.region}
       AND r.created_at >= ${request.from}::timestamptz AND r.created_at < ${request.to}::timestamptz
  `);

  const opening = Number(openingRows.rows[0]?.opening ?? 0);
  const captures = Number(capturesRows.rows[0]?.total ?? 0);
  const recoveries = Number(recoveriesRows.rows[0]?.total ?? 0);
  const refunds = 0; // The fake models no distinct refund reason yet.
  const closing = opening + captures - refunds - recoveries;
  const id = `stmt_fake_${randomUUID()}`;
  const disputeWindowEndsAt = new Date(
    new Date(request.to).getTime() + DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await db.execute(sql`
    INSERT INTO platform.ledger_fake_statement
      (id, business_id, region, currency, period_from, period_to,
       opening_payable_minor, captures_minor, refunds_minor, recoveries_minor,
       closing_payable_minor, point_purchases_minor, point_purchases_points,
       dispute_window_ends_at)
    VALUES (${id}, ${request.businessId}, ${request.region}, ${request.region === "AU" ? "AUD" : "IDR"},
            ${request.from}::timestamptz, ${request.to}::timestamptz,
            ${opening}, ${captures}, ${refunds}, ${recoveries}, ${closing}, 0, 0, ${disputeWindowEndsAt}::timestamptz)
    ON CONFLICT (business_id, region, period_from, period_to) DO NOTHING
  `);
  const stored = await db.execute<StatementRow>(sql`
    SELECT ${statementColumns} FROM platform.ledger_fake_statement
     WHERE business_id = ${request.businessId} AND region = ${request.region}
       AND period_from = ${request.from}::timestamptz AND period_to = ${request.to}::timestamptz
  `);
  const row = stored.rows[0];
  if (row === undefined) throw new Error("ledger_fake_statement lost a row it just wrote");
  return toStatement(row);
}

/** 10.1.b: every statement already generated for a business whose period falls inside [from, to). Never generates one. */
export function statements(
  db: AppDb,
  request: StatementsRequest,
): ResultAsync<readonly Statement[], LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<readonly Statement[], LedgerError>> => {
      const rows = await db.execute<StatementRow>(sql`
        SELECT ${statementColumns} FROM platform.ledger_fake_statement
         WHERE business_id = ${request.businessId}
           AND period_from >= ${request.from}::timestamptz AND period_to <= ${request.to}::timestamptz
         ORDER BY period_from DESC
      `);
      return ok(rows.rows.map(toStatement));
    })(),
  );
}

/** 10.5/10.6: every open or disputed statement in a region, oldest first. */
export function statementQueue(
  db: AppDb,
  region: string,
): ResultAsync<readonly Statement[], LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<readonly Statement[], LedgerError>> => {
      const rows = await db.execute<StatementRow>(sql`
        SELECT ${statementColumns} FROM platform.ledger_fake_statement
         WHERE region = ${region} AND status IN ('open', 'disputed')
         ORDER BY generated_at ASC
      `);
      return ok(rows.rows.map(toStatement));
    })(),
  );
}

async function getStatementRow(db: AppDb, statementId: string): Promise<StatementRow | undefined> {
  const rows = await db.execute<StatementRow>(sql`
    SELECT ${statementColumns} FROM platform.ledger_fake_statement WHERE id = ${statementId}
  `);
  return rows.rows[0];
}

/** 10.6.b: the studio's own dispute — holds the payout until staff resolve it (10.6.a). */
export function disputeStatement(
  db: AppDb,
  request: DisputeStatementRequest,
): ResultAsync<Statement, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Statement, LedgerError>> => {
      const row = await getStatementRow(db, request.statementId);
      if (row === undefined) throw new Error(`no statement ${request.statementId} exists`);
      if (row.status !== "open") {
        return err(
          ledgerError("statement_not_open", `statement ${request.statementId} is ${row.status}`),
        );
      }
      await db.execute(sql`
        UPDATE platform.ledger_fake_statement
           SET status = 'disputed', dispute_reason = ${request.reason}, disputed_at = now()
         WHERE id = ${request.statementId}
      `);
      const updated = await getStatementRow(db, request.statementId);
      if (updated === undefined)
        throw new Error("ledger_fake_statement lost a row it just updated");
      return ok(toStatement(updated));
    })(),
  );
}

/** 10.5.a: staff releases a disputed statement back to `open`. */
export function resolveStatementDispute(
  db: AppDb,
  request: ResolveStatementDisputeRequest,
): ResultAsync<Statement, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Statement, LedgerError>> => {
      const row = await getStatementRow(db, request.statementId);
      if (row === undefined) throw new Error(`no statement ${request.statementId} exists`);
      if (row.status !== "disputed") {
        return err(
          ledgerError("statement_not_open", `statement ${request.statementId} is not disputed`),
        );
      }
      await db.execute(sql`
        UPDATE platform.ledger_fake_statement
           SET status = 'open', resolution_note = ${request.note}, resolved_at = now()
         WHERE id = ${request.statementId}
      `);
      const updated = await getStatementRow(db, request.statementId);
      if (updated === undefined)
        throw new Error("ledger_fake_statement lost a row it just updated");
      return ok(toStatement(updated));
    })(),
  );
}

/** 10.1.c: after the F12 dispute window, the statement's closing payable is marked paid. */
export function approvePayout(
  db: AppDb,
  request: ApprovePayoutRequest,
): ResultAsync<Statement, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Statement, LedgerError>> => {
      const row = await getStatementRow(db, request.statementId);
      if (row === undefined) throw new Error(`no statement ${request.statementId} exists`);
      if (row.status !== "open") {
        return err(
          ledgerError("statement_not_open", `statement ${request.statementId} is ${row.status}`),
        );
      }
      if (new Date(row.dispute_window_ends_at).getTime() > Date.now()) {
        return err(
          ledgerError(
            "dispute_window_open",
            `statement ${request.statementId}'s dispute window is still open`,
          ),
        );
      }
      const transferId = `xfer_fake_payout_${randomUUID()}`;
      await db.execute(sql`
        UPDATE platform.ledger_fake_statement
           SET status = 'paid', approved_by = ${request.approvedBy}, approved_at = now(),
               payout_transfer_id = ${transferId}
         WHERE id = ${request.statementId}
      `);
      const updated = await getStatementRow(db, request.statementId);
      if (updated === undefined)
        throw new Error("ledger_fake_statement lost a row it just updated");
      return ok(toStatement(updated));
    })(),
  );
}

/**
 * 10.1.c/10.2.b: an expired voucher or a forfeited remainder never captured
 * releases its own settlement value back — the fake does not model a full
 * voucher_liability balance, so this only records the idempotent release
 * itself.
 */
export function releaseVoucherLiability(
  db: AppDb,
  request: ReleaseVoucherLiabilityRequest,
): ResultAsync<{ transferId: string }, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<{ transferId: string }, LedgerError>> => {
      const existing = await db.execute<{ transfer_id: string }>(sql`
        SELECT transfer_id FROM platform.ledger_fake_liability_release WHERE idempotency_key = ${request.idempotencyKey}
      `);
      if (existing.rows[0] !== undefined) return ok({ transferId: existing.rows[0].transfer_id });

      const transferId = `xfer_fake_release_${randomUUID()}`;
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_liability_release (idempotency_key, region, amount_minor, transfer_id)
        VALUES (${request.idempotencyKey}, ${request.region}, ${request.amountMinor}, ${transferId})
        ON CONFLICT (idempotency_key) DO NOTHING
      `);
      const stored = await db.execute<{ transfer_id: string }>(sql`
        SELECT transfer_id FROM platform.ledger_fake_liability_release WHERE idempotency_key = ${request.idempotencyKey}
      `);
      const row = stored.rows[0];
      if (row === undefined)
        throw new Error("ledger_fake_liability_release lost a row it just wrote");
      return ok({ transferId: row.transfer_id });
    })(),
  );
}
