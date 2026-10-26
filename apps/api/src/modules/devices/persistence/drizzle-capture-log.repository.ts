import { and, desc, eq, sql } from "drizzle-orm";
import { currencySchema } from "@yourtal/contracts/money/value";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { counterCaptureLog } from "./schema/counter-capture-log.table";
import type {
  CaptureLogQuery,
  CaptureLogRepository,
  CaptureLogRow,
  RecordCaptureInput,
} from "./capture-log.repository";

function toRow(row: typeof counterCaptureLog.$inferSelect): CaptureLogRow {
  return {
    captureId: row.captureId,
    deviceId: row.deviceId,
    businessId: row.businessId,
    locationId: row.locationId,
    voucherId: row.voucherId,
    amountMinor: row.amountMinor,
    currency: currencySchema.parse(row.currency),
    orderRef: row.orderRef,
    orderTotalMinor: row.orderTotalMinor,
    offerTitle: row.offerTitle,
    authorizedAt: row.authorizedAt,
    capturedAt: row.capturedAt,
  };
}

export class DrizzleCaptureLogRepository implements CaptureLogRepository {
  constructor(private readonly db: AppDb) {}

  async record(input: RecordCaptureInput): Promise<void> {
    // ON CONFLICT DO NOTHING: a retried write after a lost response (the
    // voucher service already captured; only OUR receipt of that fact was
    // lost) is a no-op, never a duplicate audit row for one real capture.
    await this.db.insert(counterCaptureLog).values(input).onConflictDoNothing();
  }

  async listTodayForDevice(deviceId: string, timeZone: string): Promise<readonly CaptureLogRow[]> {
    const rows = await this.db
      .select()
      .from(counterCaptureLog)
      .where(
        and(
          eq(counterCaptureLog.deviceId, deviceId),
          // The start of the region's day, as an instant: truncate the wall clock there, then put the zone back.
          sql`${counterCaptureLog.capturedAt} >= date_trunc('day', now() AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone}`,
        ),
      )
      .orderBy(desc(counterCaptureLog.capturedAt));
    return rows.map(toRow);
  }

  async listForBusiness(query: CaptureLogQuery): Promise<readonly CaptureLogRow[]> {
    const conditions = [eq(counterCaptureLog.businessId, query.businessId)];
    if (query.locationId !== undefined) {
      conditions.push(eq(counterCaptureLog.locationId, query.locationId));
    }
    if (query.deviceId !== undefined) {
      conditions.push(eq(counterCaptureLog.deviceId, query.deviceId));
    }
    const rows = await this.db
      .select()
      .from(counterCaptureLog)
      .where(and(...conditions))
      .orderBy(desc(counterCaptureLog.capturedAt))
      .limit(query.limit);
    return rows.map(toRow);
  }
}
