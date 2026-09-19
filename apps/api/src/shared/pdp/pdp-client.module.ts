import { Global, Module } from "@nestjs/common";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";

export const PDP_CLIENT = Symbol("PDP_CLIENT");

/**
 * The ONE place `createPdpClient` is called. Every module that needs to ask
 * the PDP a question injects `PDP_CLIENT` rather than constructing its own
 * client — that is what makes "every route resolves authz through the PDP"
 * mechanical rather than a convention someone can forget.
 *
 * This is also the seam YT-0500 (the NestJS authz guard) slots into: the
 * guard will inject this same token rather than a new one, so nothing here
 * needs to change when it lands.
 */
@Global()
@Module({
  providers: [
    {
      provide: PDP_CLIENT,
      useFactory: (config: AppConfig): PdpClient =>
        createPdpClient({ baseUrl: config.pdp.baseUrl, timeoutMs: config.pdp.timeoutMs }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [PDP_CLIENT],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class PdpClientModule {}
