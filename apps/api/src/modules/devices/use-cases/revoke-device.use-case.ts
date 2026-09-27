import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { RevokeDeviceError } from "../devices.errors";
import type {
  CounterDeviceRepository,
  CounterDeviceRow,
} from "../persistence/counter-device.repository";
import { wrapPersistence } from "../wrap-persistence";

/** Devices are revoked from Studio only (TASKS.md 8.1.a) — no other route ever calls this. */
export function revokeDevice(
  devices: CounterDeviceRepository,
  businessId: string,
  deviceId: string,
  revokedBy: string,
): ResultAsync<CounterDeviceRow, RevokeDeviceError> {
  return wrapPersistence(devices.revoke(deviceId, businessId, revokedBy)).andThen((row) =>
    row === null
      ? errAsync<CounterDeviceRow, RevokeDeviceError>({ type: "device_not_found", deviceId })
      : okAsync(row),
  );
}
