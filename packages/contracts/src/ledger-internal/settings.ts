import { z } from "zod";
import { regionSchema } from "../region/region";
import type { Region } from "../region/region";

/**
 * 1.2.f (F12/F23): the ledger-internal contract's settings slice.
 *
 * This file is deliberately separate from the rest of `ledger-internal`
 * (pricing, funding, earning, spending, users -- 1.2.a), which a different
 * session is building at the same time. Nothing here imports from a sibling
 * `ledger-internal` file, and nothing there needs to import from here except
 * to re-export it, so the two land without either session editing the
 * other's work.
 *
 * ## Where the two-person rule actually lives
 *
 * `proposeSetting` and `approveSetting` are the CONTRACT for the operation --
 * the shape a caller sends and gets back. The rule that the approver must
 * differ from the proposer is enforced twice, neither of which is "this
 * TypeScript interface": once in Cerbos (`policies/resource_policies/
 * platform_setting.yaml`'s `nobody-approves-their-own-setting-proposal`),
 * and once at the database (`platform.region_setting`'s
 * `region_setting_approval_rules()` trigger, migration 20260925193000).
 * Both would refuse a self-approval even if a future HTTP client here forgot
 * to check first -- the same "controllers never trust client-supplied scope"
 * posture the rest of this codebase holds to.
 *
 * ## Why `value` is `unknown`, not a per-key union
 *
 * A closed key list belongs in the schema that seeds these rows
 * (`packages/db/migrations/20260925193000_platform_region_setting.sql`'s F12
 * defaults), not in the contract every reader has to import — a settings
 * store that could not add a 24th key without a contract-package release
 * would defeat the point of "a config value, never a constant in code."
 * Readers narrow at the boundary, the same way `businessSchema` and every
 * other row assembler in this repo parses rather than casts.
 */

export const regionSettingSchema = z.object({
  id: z.string(),
  region: regionSchema,
  key: z.string(),
  value: z.unknown(),
  setBy: z.string(),
  /** `null` while the change is a still-pending proposal. */
  approvedBy: z.string().nullable(),
  /** `null` until approved; stamped by the database at approval time, never accepted from a caller. */
  effectiveFrom: z.string().nullable(),
});

export type RegionSetting = z.infer<typeof regionSettingSchema>;

export interface GetSettingsOperation {
  /** Every currently-effective, approved setting for one region. */
  getSettings(region: Region): Promise<readonly RegionSetting[]>;
}

export interface ProposeSettingInput {
  readonly region: Region;
  readonly key: string;
  readonly value: unknown;
  readonly proposedBy: string;
}

export interface ProposeSettingOperation {
  /** Starts a pending change. Never itself in effect — see `approveSetting`. */
  proposeSetting(input: ProposeSettingInput): Promise<RegionSetting>;
}

export interface ApproveSettingInput {
  readonly id: string;
  readonly approvedBy: string;
}

export interface ApproveSettingOperation {
  /**
   * Decides a pending change. Refused (`idempotency_conflict`-shaped, per
   * 1.2.c's closed error enum) if `approvedBy` equals the proposal's own
   * `setBy` — the two-person rule.
   */
  approveSetting(input: ApproveSettingInput): Promise<RegionSetting>;
}

/** 9.5.d's staff console calls all three through `ledger-internal`. */
export interface LedgerSettingsOperations
  extends GetSettingsOperation, ProposeSettingOperation, ApproveSettingOperation {}
