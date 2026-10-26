import type { ResultAsync } from "neverthrow";
import { toMinorUnits } from "@yourtal/contracts/money";
import { REGION_TIMEZONE } from "@yourtal/contracts/me/streak";
import type { Region } from "@yourtal/contracts/region";
import type { CounterLogEntry } from "@yourtal/contracts/device/counter-redemption";
import type { CaptureLogRepository } from "../../persistence/capture-log.repository";
import type { PersistenceFailedError } from "../../devices.errors";
import { wrapPersistence } from "../../wrap-persistence";

/** `redemption.yaml`'s `view_log` with `logScope: "today"` — a device sees only its own day. */
export function listTodayLog(
  captureLog: CaptureLogRepository,
  deviceId: string,
  region: Region,
): ResultAsync<readonly CounterLogEntry[], PersistenceFailedError> {
  return wrapPersistence(captureLog.listTodayForDevice(deviceId, REGION_TIMEZONE[region])).map(
    (rows) =>
      rows.map((row) => ({
        captureId: row.captureId,
        voucherId: row.voucherId,
        amountMinor: toMinorUnits(row.amountMinor),
        currency: row.currency,
        capturedAt: row.capturedAt.toISOString(),
        orderRef: row.orderRef,
        offerTitle: row.offerTitle,
        authorizedAt: row.authorizedAt.toISOString(),
      })),
  );
}
