import { Global, Module } from "@nestjs/common";
import { PrincipalService } from "./principal.service";

/**
 * Every module that authorizes a route imports this one and injects
 * `PrincipalService` plus `PDP_CLIENT` (from `PdpClientModule`) — see
 * `business.controller.ts` for the call-site shape every later controller
 * should copy.
 */
@Global()
@Module({
  providers: [PrincipalService],
  exports: [PrincipalService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class AuthzModule {}
