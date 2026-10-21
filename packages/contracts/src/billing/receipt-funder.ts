import * as z from "zod";
import type { RegionSetting } from "../ledger-internal/settings";
import type { Region } from "../region/region";

/**
 * 2.10.b (F127, docs/27 section 3.1): SnapApp's receipt points are paid from a
 * receipt package the partner's funder bought at cost. The funder is a region
 * setting `receipt_funder.<partnerId>` = `{"businessId":"<lowercase uuid>"}`,
 * one per partner per region, proposed and approved under the usual two-person
 * rule. The ledger reads it to find whose package pays a receipt; Studio reads
 * it to know whether a business may buy one.
 */
export const RECEIPT_FUNDER_KEY_PREFIX = "receipt_funder.";

/** The only programme a package can belong to today; null elsewhere means an ordinary package. */
export const receiptProgrammeSchema = z.literal("receipts");
export type ReceiptProgramme = z.infer<typeof receiptProgrammeSchema>;

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The setting's value. Strict: an extra key, or an upper-case id, is refused. */
export const receiptFunderValueSchema = z.strictObject({
  businessId: z.uuid().regex(LOWERCASE_UUID, "businessId must be a lowercase uuid"),
});
export type ReceiptFunderValue = z.infer<typeof receiptFunderValueSchema>;

/** `receipt_funder.<partnerId>`. */
export function receiptFunderKey(partnerId: string): string {
  return `${RECEIPT_FUNDER_KEY_PREFIX}${partnerId}`;
}

function funderOf(setting: RegionSetting): string | null {
  const parsed = receiptFunderValueSchema.safeParse(setting.value);
  return parsed.success ? parsed.data.businessId : null;
}

/**
 * The business that funds `partnerId`'s receipts in `region`, or null when
 * none is named, the proposal is not yet approved, or the stored value is
 * malformed.
 */
export function funderFor(
  settings: readonly RegionSetting[],
  partnerId: string,
  region: Region,
): string | null {
  const key = receiptFunderKey(partnerId);
  const setting = settings.find(
    (row) => row.key === key && row.region === region && row.approvedBy !== null,
  );
  return setting === undefined ? null : funderOf(setting);
}

/** Every partner with an approved funder in `region`, sorted by partner id, for the staff console. */
export function receiptFunders(
  settings: readonly RegionSetting[],
  region: Region,
): { partnerId: string; businessId: string }[] {
  const funders: { partnerId: string; businessId: string }[] = [];
  for (const row of settings) {
    if (!row.key.startsWith(RECEIPT_FUNDER_KEY_PREFIX)) continue;
    if (row.region !== region || row.approvedBy === null) continue;
    const businessId = funderOf(row);
    if (businessId === null) continue;
    funders.push({ partnerId: row.key.slice(RECEIPT_FUNDER_KEY_PREFIX.length), businessId });
  }
  return funders.sort((a, b) => a.partnerId.localeCompare(b.partnerId));
}

/** The partners `businessId` funds in `region`, sorted, for the funder's Studio panel. */
export function partnersFundedBy(
  settings: readonly RegionSetting[],
  businessId: string,
  region: Region,
): string[] {
  return settings
    .filter(
      (row) =>
        row.key.startsWith(RECEIPT_FUNDER_KEY_PREFIX) &&
        row.region === region &&
        row.approvedBy !== null &&
        funderOf(row) === businessId,
    )
    .map((row) => row.key.slice(RECEIPT_FUNDER_KEY_PREFIX.length))
    .sort();
}
