import { Global, Module } from "@nestjs/common";
import { IdentityModule } from "../../modules/identity/identity.module";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { PrincipalService } from "./principal.service";
import {
  DEVICE_CREDENTIAL_VERIFIER,
  NoDeviceCredentialVerifier,
} from "./device-credential-verifier";
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
 */
@Global()
@Module({
  imports: [IdentityModule],
  providers: [
    PrincipalService,
    AsyncPrincipalResolver,
    // 1.5.c: NoDeviceCredentialVerifier until 8.1.b's real device-credential
    // store lands — swapping the binding is the only change that task needs.
    { provide: DEVICE_CREDENTIAL_VERIFIER, useClass: NoDeviceCredentialVerifier },
    StoreDevicePrincipalResolver,
  ],
  exports: [PrincipalService, AsyncPrincipalResolver, StoreDevicePrincipalResolver],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class AuthzModule {}
