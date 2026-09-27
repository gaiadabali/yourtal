import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import { verify as argon2Verify } from "@node-rs/argon2";
import type { UnlockDeviceError } from "../devices.errors";
import type { CounterDeviceRepository, CounterDeviceRow } from "../persistence/counter-device.repository";
import { wrapPersistence } from "../wrap-persistence";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // TASKS.md 8.1.a.

/** Argon2id's own defaults never throw on a mismatch; a malformed hash is a mismatch too. */
async function verifyPin(pinHash: string, pin: string): Promise<boolean> {
  try {
    return await argon2Verify(pinHash, pin);
  } catch {
    return false;
  }
}

export function unlockDevice(
  devices: CounterDeviceRepository,
  device: CounterDeviceRow,
  pin: string,
  now: Date,
): ResultAsync<true, UnlockDeviceError> {
  if (device.pinLockedUntil !== null && device.pinLockedUntil > now) {
    return errAsync({ type: "device_locked", lockedUntil: device.pinLockedUntil.toISOString() });
  }

  return wrapPersistence(verifyPin(device.pinHash, pin)).andThen((correct) => {
    if (correct) {
      return wrapPersistence(devices.resetFailedPin(device.id)).map(() => true as const);
    }

    const attempts = device.failedPinAttempts + 1;
    const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS) : null;
    return wrapPersistence(devices.recordFailedPin(device.id, lockedUntil)).andThen(() =>
      errAsync<true, UnlockDeviceError>(
        lockedUntil !== null
          ? { type: "device_locked", lockedUntil: lockedUntil.toISOString() }
          : { type: "pin_incorrect" },
      ),
    );
  });
}
