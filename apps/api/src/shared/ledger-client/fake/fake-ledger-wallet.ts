import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toPoints } from "@yourtal/contracts/money";
import type {
  Escrow,
  EscrowRequest,
  HistoryRequest,
  LedgerBalance,
  LedgerHistoryEntry,
} from "@yourtal/contracts/ledger-internal/wallet";
import type { AppDb } from "../../persistence/drizzle-client";
import { availablePoints } from "./fake-ledger-balance";

export function escrow(db: AppDb, request: EscrowRequest): ResultAsync<Escrow, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Escrow, LedgerError>> => {
      const available = await availablePoints(db, request.userId);
      if (available < request.points) {
        return err(
          ledgerError(
            "insufficient_available",
            `user ${request.userId} has ${String(available)} available, needs ${String(request.points)}`,
          ),
        );
      }
      const id = randomUUID();
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_escrow (id, user_id, points, reason)
        VALUES (${id}, ${request.userId}, ${request.points}, ${request.reason})
      `);
      return ok({
        escrowId: id,
        userId: request.userId,
        points: request.points,
        reason: request.reason,
        state: "held",
      });
    })(),
  );
}

type EscrowRow = {
  readonly id: string;
  readonly user_id: string;
  readonly points: string;
  readonly reason: string;
  readonly state: string;
};

export function releaseEscrow(db: AppDb, escrowId: string): ResultAsync<Escrow, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<Escrow, LedgerError>> => {
      const result = await db.execute<EscrowRow>(sql`
        SELECT id, user_id, points, reason, state FROM platform.ledger_fake_escrow WHERE id = ${escrowId}
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error(`no escrow ${escrowId} exists`);
      if (row.state === "held") {
        await db.execute(
          sql`UPDATE platform.ledger_fake_escrow SET state = 'released' WHERE id = ${escrowId}`,
        );
      }
      return ok({
        escrowId: row.id,
        userId: row.user_id,
        points: toPoints(Number(row.points)),
        reason: row.reason,
        state: "released",
      });
    })(),
  );
}

export function balance(db: AppDb, userId: string): ResultAsync<LedgerBalance, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<LedgerBalance, LedgerError>> => {
      const available = await availablePoints(db, userId);
      const pendingRows = await db.execute<{ unlock_at: string; points: string }>(sql`
        SELECT unlock_at, SUM(points) AS points FROM platform.ledger_fake_grant
         WHERE user_id = ${userId} AND unlock_at > now() AND NOT reversed
         GROUP BY unlock_at ORDER BY unlock_at
      `);
      return ok({
        userId,
        availablePoints: toPoints(available),
        pending: pendingRows.rows.map((row) => ({
          points: toPoints(Number(row.points)),
          unlockAt: new Date(row.unlock_at).toISOString(),
        })),
        // F18: points never expire by default, in either region.
        expiringPoints: toPoints(0),
        expiringAt: null,
      });
    })(),
  );
}

interface CombinedEntry {
  readonly id: string;
  readonly kind: LedgerHistoryEntry["kind"];
  readonly points: number;
  readonly externalRef: string;
  readonly campaignId: string | null;
  readonly at: Date;
}

export function history(
  db: AppDb,
  request: HistoryRequest,
): ResultAsync<readonly LedgerHistoryEntry[], LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<readonly LedgerHistoryEntry[], LedgerError>> => {
      const grants = await db.execute<{
        id: string;
        points: string;
        idempotency_key: string;
        campaign_id: string | null;
        granted_at: string;
      }>(sql`
        SELECT id, points, idempotency_key, campaign_id, granted_at FROM platform.ledger_fake_grant
         WHERE user_id = ${request.userId} AND NOT reversed
      `);
      const burns = await db.execute<{ saga_id: string; points: string; burned_at: string }>(sql`
        SELECT saga_id, points, burned_at FROM platform.ledger_fake_burn WHERE user_id = ${request.userId}
      `);

      const combined: CombinedEntry[] = [
        ...grants.rows.map((row): CombinedEntry => ({
          id: row.id,
          kind: "grant",
          points: Number(row.points),
          externalRef: row.idempotency_key,
          campaignId: row.campaign_id,
          at: new Date(row.granted_at),
        })),
        ...burns.rows.map((row): CombinedEntry => ({
          id: row.saga_id,
          kind: "burn",
          points: Number(row.points),
          externalRef: row.saga_id,
          campaignId: null,
          at: new Date(row.burned_at),
        })),
      ].sort((a, b) => b.at.getTime() - a.at.getTime());

      const startIndex =
        request.startingAfter === undefined
          ? 0
          : combined.findIndex((entry) => entry.id === request.startingAfter) + 1;
      const page = combined
        .slice(startIndex, startIndex + request.limit)
        .map((entry): LedgerHistoryEntry => ({
          id: entry.id,
          kind: entry.kind,
          points: toPoints(entry.points),
          externalRef: entry.externalRef,
          campaignId: entry.campaignId,
          listingId: null,
          voucherId: null,
          at: entry.at.toISOString(),
        }));
      return ok(page);
    })(),
  );
}
