/** Discriminated unions for this module's use-cases, mapped to HTTP by `to-http-exception.ts`. */

export interface PersistenceFailedError {
  readonly type: "persistence_failed";
  readonly cause: string;
}

export interface LocationNotFoundError {
  readonly type: "location_not_found";
  readonly locationId: string;
}

export interface DeviceNotFoundError {
  readonly type: "device_not_found";
  readonly deviceId: string;
}

export interface PairingCodeInvalidError {
  readonly type: "pairing_code_invalid";
}

export interface DeviceLockedError {
  readonly type: "device_locked";
  readonly lockedUntil: string;
}

export interface PinIncorrectError {
  readonly type: "pin_incorrect";
}

export type ProvisionDeviceError = LocationNotFoundError | PersistenceFailedError;
export type ListDevicesError = PersistenceFailedError;
export type RevokeDeviceError = DeviceNotFoundError | PersistenceFailedError;
export type PairDeviceError = PairingCodeInvalidError | PersistenceFailedError;
export type UnlockDeviceError = DeviceLockedError | PinIncorrectError | PersistenceFailedError;
