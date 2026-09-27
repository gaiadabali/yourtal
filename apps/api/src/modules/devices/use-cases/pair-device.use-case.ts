import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import type { PairDeviceError } from "../devices.errors";
import type { CounterDeviceRepository } from "../persistence/counter-device.repository";
import { hashDeviceSecret, issueDeviceCredential } from "../crypto/device-token";
import { wrapPersistence } from "../wrap-persistence";

export interface PairDeviceOutcome {
  readonly deviceId: string;
  readonly credential: string;
}

/**
 * Single-use through the repository's own conditional UPDATE (8.1.a) — this
 * use-case does not add its own check-then-act race, it just interprets the
 * repository's atomic outcome. A code that is unknown, already used, revoked
 * or expired all answer identically (`pairing_code_invalid`): telling a
 * prober which one it was is a free oracle, the same reasoning
 * `redemption.yaml`'s own header gives for `lookup`.
 */
export function pairDevice(
  devices: CounterDeviceRepository,
  pairingCode: string,
  now: Date,
): ResultAsync<PairDeviceOutcome, PairDeviceError> {
  const pairingCodeHash = hashDeviceSecret(pairingCode);
  return wrapPersistence(devices.findByPairingCodeHash(pairingCodeHash)).andThen((found) => {
    if (found === null) {
      return errAsync<PairDeviceOutcome, PairDeviceError>({ type: "pairing_code_invalid" });
    }
    const credential = issueDeviceCredential();
    return wrapPersistence(devices.pair(found.id, credential.hash, now)).andThen((paired) =>
      paired === null
        ? errAsync<PairDeviceOutcome, PairDeviceError>({ type: "pairing_code_invalid" })
        : okAsync({ deviceId: paired.id, credential: credential.secret }),
    );
  });
}
