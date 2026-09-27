import { Global, Module } from "@nestjs/common";
import { IdentityModule } from "../../modules/identity/identity.module";
import { AuthModule } from "../../modules/auth/auth.module";
import { DevicesModule } from "../../modules/devices/devices.module";
import { CounterDeviceCredentialVerifier } from "../../modules/devices/counter-device-credential-verifier";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { PrincipalService } from "./principal.service";
import { DEVICE_CREDENTIAL_VERIFIER } from "./device-credential-verifier";
import { StoreDevicePrincipalResolver } from "./store-device-principal-resolver";

/**
 * Every module that authorizes a route imports this one and injects
 * `PrincipalService` plus `PDP_CLIENT` (from `PdpClientModule`) — see
 * `business.controller.ts` for the call-site shape every later controller
 * should copy.
 *
 * Also provides `AsyncPrincipalResolver` as of YT-0582: it composes
 * `PrincipalService.resolve()` with a read of
 * `identity.principal_security_state` (the freeze attribute
 * `policies/derived_roles/common.yaml` depends on) — see that class's own
 * doc comment for why it is a separate class rather than a new method on
 * `PrincipalService`. Imports `IdentityModule` to get that repository.
 *
 * Imports `AuthModule` as of 1.5.a, for the one thing `PrincipalService`
 * itself now needs: `SessionService.validateAndTouch`. `AuthModule` does not
 * import this module back (`@Global()` already makes everything here
 * visible to it without that), so this is not a cycle.
 *
 * 8.1.b: also imports `DevicesModule`, for the same reason — `DevicesModule`
 * does NOT import this one back (it does not need to: `AsyncPrincipalResolver`,
 * `StoreDevicePrincipalResolver` and `PDP_CLIENT` are already global), so this
 * is one edge, not a cycle. `DEVICE_CREDENTIAL_VERIFIER` now binds
 * `CounterDeviceCredentialVerifier` — the real, Postgres-backed
 * implementation — in place of the permanently-refusing
 * `NoDeviceCredentialVerifier`, which stays in `device-credential-verifier.ts`
 * as the safe default for anything built without this module in scope.
 */
@Global()
@Module({
  imports: [IdentityModule, AuthModule, DevicesModule],
  providers: [
    PrincipalService,
    AsyncPrincipalResolver,
    { provide: DEVICE_CREDENTIAL_VERIFIER, useExisting: CounterDeviceCredentialVerifier },
    StoreDevicePrincipalResolver,
  ],
  exports: [PrincipalService, AsyncPrincipalResolver, StoreDevicePrincipalResolver],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class AuthzModule {}
