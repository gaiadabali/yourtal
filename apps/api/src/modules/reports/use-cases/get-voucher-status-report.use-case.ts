import { sql } from "drizzle-orm";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import type { VoucherStatus } from "@yourtal/contracts/voucher";
import type { VoucherStatusReport } from "@yourtal/contracts/report/voucher-status-report";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { VoucherInternalClient } from "../../../shared/voucher-client/voucher-internal-client";
import { COHORT_FLOOR, TEEN_COHORT_FLOOR } from "../cohort-floor";

/** Redeemed first: it is the number a business opens this panel to find. */
const ORDER: readonly VoucherStatus[] = ["redeemed", "active", "expired", "transferred"];

/**
 * 13.10: the business's own vouchers by status, in its own region. `null`
 * when the tenant is not a business. Suppressed below the cohort floor,
 * which is the teen floor once any of its listings is for teens.
 */
export async function getVoucherStatusReport(
  db: AppDb,
  vouchers: VoucherInternalClient,
  businessId: string,
): Promise<VoucherStatusReport | null> {
  const scope = await db.execute<{ region: Region; teen: boolean }>(sql`
    SELECT b.region,
           EXISTS (SELECT 1 FROM store.listings l WHERE l.merchant_id = b.id AND l.audience = 'teen') AS teen
      FROM business.business_accounts b WHERE b.id = ${businessId}
  `);
  const business = scope.rows[0];
  if (business === undefined) return null;

  const counted = await vouchers.merchantVoucherStatus({
    merchantId: businessId,
    region: business.region,
  });
  if (counted.isErr()) throw new Error(`voucher status counts: ${counted.error.message}`);
  const { rows, currency } = counted.value;

  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const floor = business.teen ? TEEN_COHORT_FLOOR : COHORT_FLOOR;
  if (totalCount < floor) return { suppressed: true, floor };
  return {
    suppressed: false,
    region: business.region,
    currency,
    totalCount,
    rows: ORDER.map(
      (status) =>
        rows.find((row) => row.status === status) ?? {
          status,
          count: 0,
          faceValueMinor: toMinorUnits(0),
        },
    ),
  };
}
