/**
 * 1.5.c: the port `StoreDevicePrincipalResolver` calls to turn a device's
 * own credential into the facts a `store_device` principal needs
 * (`policies/_schemas/principal.json`'s `deviceBusinessId`/
 * `deviceLocationId`, both set only at provisioning time and never taken
 * from the request — see that schema's own comments on why: a stolen device
 * must not be able to name a different merchant).
 *
 * `apps/api/src/modules/devices` (8.1.b) provisions and revokes these
 * credentials and binds the real implementation of `verify` —
 * `CounterDeviceCredentialVerifier`, in that module, since it needs the
 * device repository this shared file must not depend on. Until 8.1.b,
 * `NoDeviceCredentialVerifier` was the only registration — every credential
 * invalid, so every request through this resolver got a clear 401 rather
 * than the guard silently treating an unauthenticated terminal as some
 * other kind of principal. It stays here as the safe default for anything
 * that constructs `StoreDevicePrincipalResolver` without the devices module
 * in scope (a unit test, say).
 *
 * 8.1.b: `secret` carries the device's own bearer credential (the
 * `Authorization: Bearer` value) — the `x-yt-device-id` header this
 * resolver used to trust ALONE named a device with no proof at all, which
 * is exactly the "a stolen phone claims a different merchant" shape this
 * file's own header already warns about. `deviceId` is kept for whatever
 * hint of identity the header still carries (logging, mostly); `verify`
 * below decides identity from the secret, never from the id alone.
 */
export interface DeviceCredential {
  readonly deviceId: string;
  readonly secret: string | undefined;
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
