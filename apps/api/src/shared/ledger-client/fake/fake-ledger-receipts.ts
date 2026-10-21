import { sql } from "drizzle-orm";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import {
  RECEIPT_FUNDER_KEY_PREFIX,
  funderFor,
  partnersFundedBy,
} from "@yourtal/contracts/billing/receipt-funder";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { RegionSetting } from "@yourtal/contracts/ledger-internal/settings";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * 2.10.b (F127, docs/27 §3.1–3.3): the fake's twin of services/ledger's
 * receipt funder lookup (`settings.IsReceiptFunderIn`, `ReceiptFunderFor`)
 * and of T2b's receipt draw (`reward/receipts.go`).
 */
type Executor = Pick<AppDb, "execute">;

/**
 * The switch. The live ledger pays receipts from marketing until T2b flips
 * `receipt_scanned` to `MarketingFunded: false` (with migration B); the fake
 * follows it, so dev and the partner e2e suites keep earning until then.
 * T2b sets this to true in the same change. Before that, a client built with
 * `{ receiptDraw: true }` (the contract spec) runs the draw.
 */
export const RECEIPT_DRAW_IN_FORCE = false;

export interface FakeLedgerOptions {
  /** Receipts draw from the funder's receipt packages; campaigns refuse a package. */
  readonly receiptDraw: boolean;
}

export const DEFAULT_FAKE_LEDGER_OPTIONS: FakeLedgerOptions = {
  receiptDraw: RECEIPT_DRAW_IN_FORCE,
};

/** Every approved receipt funder setting in force in `region`, latest per key, as `platform.ledger_setting` serves them. */
async function funderSettings(executor: Executor, region: Region): Promise<RegionSetting[]> {
  const { rows } = await executor.execute<{
    id: string;
    key: string;
    value: unknown;
    set_by: string;
    approved_by: string | null;
  }>(sql`
    SELECT DISTINCT ON (key) id, key, value, set_by, approved_by
      FROM platform.region_setting
     WHERE region = ${region} AND starts_with(key, ${RECEIPT_FUNDER_KEY_PREFIX})
       AND approved_by IS NOT NULL AND effective_from <= now()
     ORDER BY key, effective_from DESC
  `);
  return rows.map((row) => ({
    id: row.id,
    region,
    key: row.key,
    value: row.value,
    setBy: row.set_by,
    approvedBy: row.approved_by,
    effectiveFrom: null,
  }));
}

/** As `checkReceiptFunder`: a business that funds no partner's receipts in the region is refused. */
export async function receiptFunderRefusal(
  executor: Executor,
  region: Region,
  businessId: string,
): Promise<LedgerError | null> {
  const partners = partnersFundedBy(await funderSettings(executor, region), businessId, region);
  return partners.length > 0
    ? null
    : ledgerError("refused", `${businessId} is not a receipt funder in ${region}`);
}

/**
 * T2b's `drawReceipt`: the oldest of the partner's funder's receipt packages
 * with room for every point (a grant is never split) pays it. No funder, no
 * package or no room is `allocation_exhausted`. Serialised per funder and
 * region, so two receipts never take the same last points.
 */
export async function drawReceipt(
  tx: Executor,
  request: { readonly partnerId: string; readonly region: Region; readonly points: number },
): Promise<Result<string, LedgerError>> {
  const exhausted = (why: string) =>
    err(ledgerError("allocation_exhausted", `${request.partnerId}'s receipts: ${why}`));
  const funder = funderFor(
    await funderSettings(tx, request.region),
    request.partnerId,
    request.region,
  );
  if (funder === null) return exhausted(`no receipt funder in ${request.region}`);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fake.receipts:${funder}:${request.region}`}, 0))`,
  );
  const drawn = await tx.execute<{ id: string }>(sql`
    UPDATE platform.ledger_fake_allocation
       SET remaining_points = remaining_points - ${request.points}
     WHERE id = (SELECT id FROM platform.ledger_fake_allocation
                  WHERE business_id = ${funder}::uuid AND region = ${request.region}
                    AND programme = 'receipts' AND remaining_points >= ${request.points}
                  ORDER BY created_at, id LIMIT 1)
    RETURNING id
  `);
  const allocationId = drawn.rows[0]?.id;
  return allocationId === undefined
    ? exhausted(`no receipt package has ${String(request.points)} points left`)
    : ok(allocationId);
}

/** Whether `allocationId` is a receipt package, which no campaign path may hold or pay from. */
export async function isReceiptPackage(executor: Executor, allocationId: string): Promise<boolean> {
  const { rows } = await executor.execute<{ programme: string | null }>(sql`
    SELECT programme FROM platform.ledger_fake_allocation WHERE id = ${allocationId}
  `);
  return rows[0]?.programme === "receipts";
}

export function receiptPackageRefusal(allocationId: string): LedgerError {
  return ledgerError(
    "refused",
    `allocation ${allocationId} is a receipt package; it pays receipts only`,
  );
}
