import { and, desc, eq } from "drizzle-orm";
import { currencySchema } from "@yourtal/contracts/money/value";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { StudioRedemptionEntry } from "@yourtal/contracts/device/studio-redemptions";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { counterCaptureLog } from "./persistence/schema/counter-capture-log.table";
import { counterDevices } from "./persistence/schema/counter-device.table";
import { merchantLocations } from "../store/persistence/schema/listing.table";

export interface StudioRedemptionQuery {
  readonly businessId: string;
  readonly locationId?: string;
  readonly deviceId?: string;
  readonly limit: number;
}

/**
 * 8.2.g: the one join `CaptureLogRepository` deliberately does not do —
 * device label and location name are for THIS screen only, not the
 * device's or the capture's own shape (`CounterLogEntry`).
 */
export async function listStudioRedemptions(
  db: AppDb,
  query: StudioRedemptionQuery,
): Promise<readonly StudioRedemptionEntry[]> {
  const conditions = [eq(counterCaptureLog.businessId, query.businessId)];
  if (query.locationId !== undefined) {
    conditions.push(eq(counterCaptureLog.locationId, query.locationId));
  }
  if (query.deviceId !== undefined) {
    conditions.push(eq(counterCaptureLog.deviceId, query.deviceId));
  }

  const rows = await db
    .select({
      captureId: counterCaptureLog.captureId,
      deviceId: counterCaptureLog.deviceId,
      deviceLabel: counterDevices.label,
      locationId: counterCaptureLog.locationId,
      locationName: merchantLocations.name,
      voucherId: counterCaptureLog.voucherId,
      amountMinor: counterCaptureLog.amountMinor,
      currency: counterCaptureLog.currency,
      orderRef: counterCaptureLog.orderRef,
      capturedAt: counterCaptureLog.capturedAt,
    })
    .from(counterCaptureLog)
    .innerJoin(counterDevices, eq(counterDevices.id, counterCaptureLog.deviceId))
    .innerJoin(merchantLocations, eq(merchantLocations.id, counterCaptureLog.locationId))
    .where(and(...conditions))
    .orderBy(desc(counterCaptureLog.capturedAt))
    .limit(query.limit);

  return rows.map((row) => ({
    captureId: row.captureId,
    deviceId: row.deviceId,
    deviceLabel: row.deviceLabel,
    locationId: row.locationId,
    locationName: row.locationName,
    voucherId: row.voucherId,
    amountMinor: toMinorUnits(row.amountMinor),
    currency: currencySchema.parse(row.currency),
    orderRef: row.orderRef,
    capturedAt: row.capturedAt.toISOString(),
  }));
}
