import { sql } from "drizzle-orm";
import type { Region } from "@yourtal/contracts/region";
import type {
  ApproveSettingInput,
  ProposeSettingInput,
  RegionSetting,
} from "@yourtal/contracts/ledger-internal/settings";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * TASKS.md 1.2.g: `getSettings`/`proposeSetting`/`approveSetting` against the
 * REAL `platform.region_setting` table (1.2.f, migration 20260925193000),
 * not a `platform.ledger_fake_*` mirror — there is only one staff-facing
 * settings ledger, fake or live, so `LEDGER_MODE=fake` reads and writes the
 * same rows 9.5.d's staff console eventually will. The two-person rule is
 * NOT re-checked here: `region_setting_approval_rules()` (the trigger that
 * migration installs) is the one place that decides it, so a self-approval
 * attempt reaches this function as a rejected promise from the database,
 * not a code path this file has to duplicate.
 */

type RegionSettingRow = {
  readonly id: string;
  readonly region: string;
  readonly key: string;
  readonly value: unknown;
  readonly set_by: string;
  readonly approved_by: string | null;
  readonly effective_from: string | null;
};

function toRegionSetting(row: RegionSettingRow): RegionSetting {
  return {
    id: row.id,
    region: row.region as RegionSetting["region"],
    key: row.key,
    value: row.value,
    setBy: row.set_by,
    approvedBy: row.approved_by,
    effectiveFrom: row.effective_from,
  };
}

/** Every currently-effective, approved setting for one region (latest per key). */
export async function getSettings(db: AppDb, region: Region): Promise<readonly RegionSetting[]> {
  const rows = await db.execute<RegionSettingRow>(sql`
    SELECT DISTINCT ON (key) id, region, key, value, set_by, approved_by, effective_from
      FROM platform.region_setting
     WHERE region = ${region} AND approved_by IS NOT NULL AND effective_from <= now()
     ORDER BY key, effective_from DESC
  `);
  return rows.rows.map(toRegionSetting);
}

/** Starts a pending change. Never itself in effect — see `approveSetting`. */
export async function proposeSetting(
  db: AppDb,
  input: ProposeSettingInput,
): Promise<RegionSetting> {
  const rows = await db.execute<RegionSettingRow>(sql`
    INSERT INTO platform.region_setting (region, key, value, set_by)
    VALUES (${input.region}, ${input.key}, ${JSON.stringify(input.value)}::jsonb, ${input.proposedBy})
    RETURNING id, region, key, value, set_by, approved_by, effective_from
  `);
  const row = rows.rows[0];
  if (row === undefined) throw new Error("propose setting insert returned no row");
  return toRegionSetting(row);
}

/**
 * Decides a pending change. `effective_from` is stamped by the trigger, not
 * here; a self-approval, or approving an already-decided row, reaches the
 * caller as a rejected promise from the trigger's `RAISE EXCEPTION`.
 */
export async function approveSetting(
  db: AppDb,
  input: ApproveSettingInput,
): Promise<RegionSetting> {
  const rows = await db.execute<RegionSettingRow>(sql`
    UPDATE platform.region_setting SET approved_by = ${input.approvedBy}
     WHERE id = ${input.id}
     RETURNING id, region, key, value, set_by, approved_by, effective_from
  `);
  const row = rows.rows[0];
  if (row === undefined) throw new Error(`no region_setting ${input.id} exists`);
  return toRegionSetting(row);
}
