import type { ResultAsync } from "neverthrow";
import type { CounterLogEntry } from "@yourtal/contracts/device/counter-redemption";
import type { CaptureLogRepository } from "../../persistence/capture-log.repository";
import type { PersistenceFailedError } from "../../devices.errors";
import { wrapPersistence } from "../../wrap-persistence";

/** `redemption.yaml`'s `view_log` with `logScope: "today"` — a device sees only its own day. */
export function listTodayLog(
  captureLog: CaptureLogRepository,
  deviceId: string,
): ResultAsync<readonly CounterLogEntry[], PersistenceFailedError> {
  return wrapPersistence(captureLog.listTodayForDevice(deviceId)).map((rows) =>
    rows.map((row) => ({
      captureId: row.captureId,
      voucherId: row.voucherId,
      amountMinor: row.amountMinor,
      currency: row.currency,
      capturedAt: row.capturedAt.toISOString(),
      orderRef: row.orderRef,
      authorizedAt: row.authorizedAt.toISOString(),
    })),
  );
}
