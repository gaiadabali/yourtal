import { Inject, Injectable } from "@nestjs/common";
import type {
  DeviceCredential,
  DeviceCredentialVerifier,
  VerifiedDeviceCredential,
} from "../../shared/authz/device-credential-verifier";
import { hashDeviceSecret } from "./crypto/device-token";
import { COUNTER_DEVICE_REPOSITORY } from "./persistence/counter-device.repository";
import type { CounterDeviceRepository } from "./persistence/counter-device.repository";

/**
 * TASKS.md 8.1.b: the real `DeviceCredentialVerifier`, replacing
 * `NoDeviceCredentialVerifier` (`shared/authz/device-credential-verifier.ts`,
 * still Area A's file — see `devices.module.ts` and `authz.module.ts` for
 * how this gets bound in its place). Hashes the presented secret and looks
 * up an unrevoked device by that hash — `null` for anything else (unknown,
 * revoked, or never paired), which `StoreDevicePrincipalResolver` turns
 * into a 401.
 */
@Injectable()
export class CounterDeviceCredentialVerifier implements DeviceCredentialVerifier {
  constructor(
    @Inject(COUNTER_DEVICE_REPOSITORY) private readonly devices: CounterDeviceRepository,
  ) {}

  async verify(credential: DeviceCredential): Promise<VerifiedDeviceCredential | null> {
    if (credential.secret === undefined) return null;
    const device = await this.devices.findActiveByCredentialHash(
      hashDeviceSecret(credential.secret),
    );
    if (device === null) return null;
    return {
      deviceId: device.id,
      jurisdiction: device.region,
      businessId: device.businessId,
      locationId: device.locationId,
    };
  }
}
