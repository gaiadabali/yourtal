import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type {
  RiskFlag,
  RiskQueueList,
  RiskQueueListRequest,
  RiskQueueResolveRequest,
} from "@yourtal/contracts/ledger-internal/risk";
import type { AppDb } from "../../persistence/drizzle-client";
import { releaseEscrow as releaseFakeEscrow } from "./fake-ledger-wallet";

/**
 * TASKS.md 10.5: the fake ledger's own `platform.ledger_fake_risk_flag`
 * (20260929060600) — LEDGER_MODE=fake never runs the real Go RiskGate, so
 * nothing here ever WRITES a flag on its own; a test seeds one directly by
 * SQL (the same convention platform.ledger_fake_escrow's own tests use),
 * and this file is only the read/resolve half a staff screen needs.
 */

type RiskFlagRow = {
  readonly id: string;
  readonly user_id: string;
  readonly region: string;
  readonly severity: string;
  readonly reason: string;
  readonly signals: unknown;
  readonly escrow_id: string | null;
  readonly status: string;
  readonly created_at: Date;
  readonly resolved_at: Date | null;
  readonly resolved_by: string | null;
  readonly resolution_note: string | null;
};

function toRiskFlag(row: RiskFlagRow): RiskFlag {
  return {
    id: row.id,
    userId: row.user_id,
    region: row.region as RiskFlag["region"],
    severity: row.severity as RiskFlag["severity"],
    reason: row.reason,
    signals: Array.isArray(row.signals) ? (row.signals as RiskFlag["signals"]) : [],
    escrowId: row.escrow_id ?? undefined,
    status: row.status as RiskFlag["status"],
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString(),
    resolvedBy: row.resolved_by ?? undefined,
    resolutionNote: row.resolution_note ?? undefined,
  };
}

export function riskQueueList(db: AppDb, request: RiskQueueListRequest): ResultAsync<RiskQueueList, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<RiskQueueList, LedgerError>> => {
      const limit = request.limit ?? 50;
      const result = await db.execute<RiskFlagRow>(sql`
        SELECT id, user_id, region, severity, reason, signals, escrow_id, status,
               created_at, resolved_at, resolved_by, resolution_note
        FROM platform.ledger_fake_risk_flag
        WHERE region = ${request.region} AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT ${limit}
      `);
      return ok({ flags: result.rows.map(toRiskFlag) });
    })(),
  );
}

async function readFlag(db: AppDb, id: string): Promise<RiskFlagRow | undefined> {
  const result = await db.execute<RiskFlagRow>(sql`
    SELECT id, user_id, region, severity, reason, signals, escrow_id, status,
           created_at, resolved_at, resolved_by, resolution_note
    FROM platform.ledger_fake_risk_flag WHERE id = ${id}
  `);
  return result.rows[0];
}

export function riskQueueRelease(db: AppDb, request: RiskQueueResolveRequest): ResultAsync<RiskFlag, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<RiskFlag, LedgerError>> => {
      const flag = await readFlag(db, request.id);
      if (flag === undefined) return err(ledgerError("idempotency_conflict", `no risk flag ${request.id}`));
      if (flag.status !== "pending") {
        return err(ledgerError("idempotency_conflict", `risk flag ${request.id} is not pending`));
      }
      if (flag.escrow_id !== null) {
        const released = await releaseFakeEscrow(db, flag.escrow_id);
        if (released.isErr()) return err(released.error);
      }
      await db.execute(sql`
        UPDATE platform.ledger_fake_risk_flag
           SET status = 'released', resolved_at = now(), resolved_by = ${request.resolvedBy},
               resolution_note = ${request.resolutionNote ?? null}
         WHERE id = ${request.id}
      `);
      const updated = await readFlag(db, request.id);
      if (updated === undefined) throw new Error(`risk flag ${request.id} vanished after release`);
      return ok(toRiskFlag(updated));
    })(),
  );
}

export function riskQueueSuspend(db: AppDb, request: RiskQueueResolveRequest): ResultAsync<RiskFlag, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<RiskFlag, LedgerError>> => {
      const flag = await readFlag(db, request.id);
      if (flag === undefined) return err(ledgerError("idempotency_conflict", `no risk flag ${request.id}`));
      if (flag.status !== "pending") {
        return err(ledgerError("idempotency_conflict", `risk flag ${request.id} is not pending`));
      }
      await db.execute(sql`
        UPDATE platform.ledger_fake_risk_flag
           SET status = 'suspended', resolved_at = now(), resolved_by = ${request.resolvedBy},
               resolution_note = ${request.resolutionNote ?? null}
         WHERE id = ${request.id}
      `);
      const updated = await readFlag(db, request.id);
      if (updated === undefined) throw new Error(`risk flag ${request.id} vanished after suspend`);
      return ok(toRiskFlag(updated));
    })(),
  );
}
