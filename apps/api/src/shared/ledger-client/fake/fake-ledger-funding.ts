import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toPoints } from "@yourtal/contracts/money";
import type {
  Allocation,
  CampaignSpend,
  Hold,
  HoldRequest,
  PurchasePointsRequest,
  ReturnGrantRequest,
} from "@yourtal/contracts/ledger-internal/funding";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * TASKS.md 1.2.a's funding group, against `platform.ledger_fake_allocation`
 * and `platform.ledger_fake_hold`.
 *
 * "Not found" (an allocation, hold or grant id nobody minted) is not one of
 * 1.2.c's twelve closed codes and is treated as a caller bug, not an
 * expected business outcome — these ids are always ones the fake itself
 * returned from an earlier call, never client input. Those cases throw
 * rather than returning a `LedgerError`, which is why `.execute` failures
 * are allowed to propagate out of the `ResultAsync` constructor's promise.
 */

type AllocationRow = {
  readonly id: string;
  readonly business_id: string;
  readonly region: string;
  readonly funder_type: string;
  readonly total_points: string;
  readonly remaining_points: string;
  readonly created_at: string;
}

function toAllocation(row: AllocationRow): Allocation {
  return {
    allocationId: row.id,
    businessId: row.business_id,
    region: row.region as Allocation["region"],
    funderType: row.funder_type as Allocation["funderType"],
    totalPoints: toPoints(Number(row.total_points)),
    remainingPoints: toPoints(Number(row.remaining_points)),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function purchasePoints(
  db: AppDb,
  request: PurchasePointsRequest,
): ResultAsync<Allocation, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Allocation, LedgerError>> => {
      const existing = await db.execute<{
        allocation_id: string;
        business_id: string;
        region: string;
        currency: string;
        points: string;
        paid_minor: string;
      }>(sql`
        SELECT allocation_id, business_id, region, currency, points, paid_minor
          FROM platform.ledger_fake_point_purchase WHERE idempotency_key = ${request.idempotencyKey}
      `);
      const priorRow = existing.rows[0];
      if (priorRow !== undefined) {
        const matches =
          priorRow.business_id === request.businessId &&
          priorRow.region === request.region &&
          priorRow.currency === request.currency &&
          Number(priorRow.points) === request.points &&
          Number(priorRow.paid_minor) === request.paidMinor;
        if (!matches) {
          return err(
            ledgerError(
              "idempotency_conflict",
              `idempotency key ${request.idempotencyKey} was already used for a different purchase`,
            ),
          );
        }
        const allocationRows = await db.execute<AllocationRow>(sql`
          SELECT id, business_id, region, funder_type, total_points, remaining_points, created_at
            FROM platform.ledger_fake_allocation WHERE id = ${priorRow.allocation_id}
        `);
        const row = allocationRows.rows[0];
        if (row === undefined) throw new Error("point purchase replay: allocation vanished");
        return ok(toAllocation(row));
      }

      const allocationId = randomUUID();
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_allocation
          (id, business_id, region, funder_type, currency, total_points, remaining_points)
        VALUES (${allocationId}, ${request.businessId}, ${request.region}, 'partner',
                ${request.currency}, ${request.points}, ${request.points})
      `);
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_point_purchase
          (id, business_id, region, currency, points, paid_minor, allocation_id, idempotency_key)
        VALUES (${randomUUID()}, ${request.businessId}, ${request.region}, ${request.currency},
                ${request.points}, ${request.paidMinor}, ${allocationId}, ${request.idempotencyKey})
      `);
      return ok({
        allocationId,
        businessId: request.businessId,
        region: request.region,
        funderType: "partner",
        totalPoints: request.points,
        remainingPoints: request.points,
        createdAt: new Date().toISOString(),
      });
    })(),
  );
}

export function listAllocations(
  db: AppDb,
  businessId: string,
): ResultAsync<readonly Allocation[], LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<readonly Allocation[], LedgerError>> => {
      const result = await db.execute<AllocationRow>(sql`
        SELECT id, business_id, region, funder_type, total_points, remaining_points, created_at
          FROM platform.ledger_fake_allocation WHERE business_id = ${businessId}
         ORDER BY created_at
      `);
      return ok(result.rows.map(toAllocation));
    })(),
  );
}

export function getAllocation(db: AppDb, allocationId: string): ResultAsync<Allocation, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Allocation, LedgerError>> => {
      const result = await db.execute<AllocationRow>(sql`
        SELECT id, business_id, region, funder_type, total_points, remaining_points, created_at
          FROM platform.ledger_fake_allocation WHERE id = ${allocationId}
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error(`no allocation ${allocationId} exists`);
      return ok(toAllocation(row));
    })(),
  );
}

type HoldRow = {
  readonly id: string;
  readonly allocation_id: string;
  readonly points: string;
  readonly saga_id: string;
  readonly state: string;
}

function toHold(row: HoldRow): Hold {
  return {
    holdId: row.id,
    allocationId: row.allocation_id,
    points: toPoints(Number(row.points)),
    sagaId: row.saga_id,
    state: row.state as Hold["state"],
  };
}

export function hold(db: AppDb, request: HoldRequest): ResultAsync<Hold, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Hold, LedgerError>> => {
      const existing = await db.execute<HoldRow>(sql`
        SELECT id, allocation_id, points, saga_id, state
          FROM platform.ledger_fake_hold WHERE saga_id = ${request.sagaId}
      `);
      const priorHold = existing.rows[0];
      if (priorHold !== undefined) {
        if (priorHold.allocation_id !== request.allocationId || Number(priorHold.points) !== request.points) {
          return err(
            ledgerError(
              "idempotency_conflict",
              `saga ${request.sagaId} was already used for a different hold`,
            ),
          );
        }
        return ok(toHold(priorHold));
      }

      const id = randomUUID();
      const claimed = await db.execute<{ id: string }>(sql`
        UPDATE platform.ledger_fake_allocation
           SET remaining_points = remaining_points - ${request.points}
         WHERE id = ${request.allocationId} AND remaining_points >= ${request.points}
        RETURNING id
      `);
      if (claimed.rows[0] === undefined) {
        return err(
          ledgerError(
            "allocation_exhausted",
            `allocation ${request.allocationId} has fewer than ${String(request.points)} points remaining`,
          ),
        );
      }
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_hold (id, allocation_id, points, saga_id, state)
        VALUES (${id}, ${request.allocationId}, ${request.points}, ${request.sagaId}, 'held')
      `);
      return ok({ holdId: id, allocationId: request.allocationId, points: request.points, sagaId: request.sagaId, state: "held" });
    })(),
  );
}

async function loadHold(db: AppDb, holdId: string): Promise<HoldRow> {
  const result = await db.execute<HoldRow>(sql`
    SELECT id, allocation_id, points, saga_id, state
      FROM platform.ledger_fake_hold WHERE id = ${holdId}
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no hold ${holdId} exists`);
  return row;
}

export function consume(db: AppDb, holdId: string): ResultAsync<Hold, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Hold, LedgerError>> => {
      const row = await loadHold(db, holdId);
      if (row.state === "consumed") return ok(toHold(row));
      if (row.state === "released") {
        throw new Error(`hold ${holdId} was already released and cannot be consumed`);
      }
      await db.execute(sql`UPDATE platform.ledger_fake_hold SET state = 'consumed' WHERE id = ${holdId}`);
      return ok(toHold({ ...row, state: "consumed" }));
    })(),
  );
}

export function release(db: AppDb, holdId: string): ResultAsync<Hold, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Hold, LedgerError>> => {
      const row = await loadHold(db, holdId);
      if (row.state === "released") return ok(toHold(row));
      if (row.state === "consumed") {
        throw new Error(`hold ${holdId} was already consumed and cannot be released`);
      }
      await db.execute(sql`
        UPDATE platform.ledger_fake_allocation SET remaining_points = remaining_points + ${row.points}
         WHERE id = ${row.allocation_id}
      `);
      await db.execute(sql`UPDATE platform.ledger_fake_hold SET state = 'released' WHERE id = ${holdId}`);
      return ok(toHold({ ...row, state: "released" }));
    })(),
  );
}

export function returnGrant(db: AppDb, request: ReturnGrantRequest): ResultAsync<void, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<void, LedgerError>> => {
      await db.execute(sql`
        UPDATE platform.ledger_fake_grant SET reversed = true WHERE id = ${request.grantId}
      `);
      return ok(undefined);
    })(),
  );
}

export function campaignSpend(db: AppDb, campaignId: string): ResultAsync<CampaignSpend, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<CampaignSpend, LedgerError>> => {
      const result = await db.execute<{
        allocation_id: string | null;
        granted_points: string;
        completions: string;
      }>(sql`
        SELECT allocation_id, COALESCE(SUM(points), 0) AS granted_points, COUNT(*) AS completions
          FROM platform.ledger_fake_grant
         WHERE campaign_id = ${campaignId} AND NOT reversed
         GROUP BY allocation_id
      `);
      const row = result.rows[0];
      return ok({
        campaignId,
        allocationId: row?.allocation_id ?? "",
        grantedPoints: toPoints(Number(row?.granted_points ?? 0)),
        completions: Number(row?.completions ?? 0),
      });
    })(),
  );
}
