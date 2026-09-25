/**
 * 1.5.c: the port `StoreDevicePrincipalResolver` calls to turn a device's
 * own credential into the facts a `store_device` principal needs
 * (`policies/_schemas/principal.json`'s `deviceBusinessId`/
 * `deviceLocationId`, both set only at provisioning time and never taken
 * from the request — see that schema's own comments on why: a stolen device
 * must not be able to name a different merchant).
 *
 * `services/devices` (8.1.b) provisions and revokes these credentials and
 * is the eventual real implementation of `verify`. Until it exists,
 * `NoDeviceCredentialVerifier` is registered instead — every credential is
 * invalid, so every request through this resolver gets a clear 401 rather
 * than the guard silently treating an unauthenticated terminal as some
 * other kind of principal.
 */
export interface DeviceCredential {
  readonly deviceId: string;
}

export interface VerifiedDeviceCredential {
  readonly deviceId: string;
  readonly jurisdiction: "AU" | "ID";
  readonly businessId: string;
  readonly locationId: string;
}

export interface DeviceCredentialVerifier {
  /** `null` when the credential is unknown, revoked or expired. */
  verify(credential: DeviceCredential): Promise<VerifiedDeviceCredential | null>;
}

export const DEVICE_CREDENTIAL_VERIFIER = Symbol("DEVICE_CREDENTIAL_VERIFIER");

/** The default binding until 8.1.b's real device-credential store lands. */
export class NoDeviceCredentialVerifier implements DeviceCredentialVerifier {
  verify(): Promise<VerifiedDeviceCredential | null> {
    return Promise.resolve(null);
  }
}
