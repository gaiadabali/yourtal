import type { ResultAsync } from "neverthrow";
import type { ListDevicesError } from "../devices.errors";
import type {
  CounterDeviceRepository,
  CounterDeviceRow,
} from "../persistence/counter-device.repository";
import { wrapPersistence } from "../wrap-persistence";

export function listDevices(
  devices: CounterDeviceRepository,
  businessId: string,
): ResultAsync<readonly CounterDeviceRow[], ListDevicesError> {
  return wrapPersistence(devices.listForBusiness(businessId));
}
