import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { KillSwitch, SetKillSwitchRequest } from "@yourtal/contracts/voucher-internal/kill-switch";
import type { VoucherError } from "../voucher-internal-client";
import type { AppDb } from "../../persistence/drizzle-client";

type KillSwitchRow = {
  readonly id: string;
  readonly scope: string;
  readonly target_id: string | null;
  readonly reason: string;
  readonly set_by: string;
  readonly active: boolean;
  readonly set_at: string;
};

function toKillSwitch(row: KillSwitchRow): KillSwitch {
  return {
    killSwitchId: row.id,
    scope: row.scope as KillSwitch["scope"],
    targetId: row.target_id,
    reason: row.reason,
    setBy: row.set_by,
    active: row.active,
    setAt: new Date(row.set_at).toISOString(),
  };
}

export function setKillSwitch(
  db: AppDb,
  request: SetKillSwitchRequest,
): ResultAsync<KillSwitch, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<KillSwitch, VoucherError>> => {
      const id = randomUUID();
      await db.execute(sql`
        INSERT INTO platform.voucher_fake_kill_switch (id, scope, target_id, reason, set_by, active)
        VALUES (${id}, ${request.scope}, ${request.targetId}, ${request.reason}, ${request.setBy}, ${request.active})
      `);
      return ok({
        killSwitchId: id,
        scope: request.scope,
        targetId: request.targetId,
        reason: request.reason,
        setBy: request.setBy,
        active: request.active,
        setAt: new Date().toISOString(),
      });
    })(),
  );
}

export function listKillSwitches(db: AppDb): ResultAsync<readonly KillSwitch[], VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<readonly KillSwitch[], VoucherError>> => {
      const result = await db.execute<KillSwitchRow>(sql`
        SELECT id, scope, target_id, reason, set_by, active, set_at
          FROM platform.voucher_fake_kill_switch WHERE active ORDER BY set_at DESC
      `);
      return ok(result.rows.map(toKillSwitch));
    })(),
  );
}
