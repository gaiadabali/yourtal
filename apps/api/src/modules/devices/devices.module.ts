import { Module } from "@nestjs/common";
import { PdpClientModule } from "../../shared/pdp/pdp-client.module";
import { RateLimitModule } from "../../shared/rate-limit/rate-limit.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { BUSINESS_REGION_LOOKUP } from "../store/persistence/business-region-lookup";
import { StudioDevicesController } from "./studio-devices.controller";
import { DevicePairingController } from "./device-pairing.controller";
import { DeviceUnlockController } from "./device-unlock.controller";
import { COUNTER_DEVICE_REPOSITORY } from "./persistence/counter-device.repository";
import { DrizzleCounterDeviceRepository } from "./persistence/drizzle-counter-device.repository";
import { MERCHANT_LOCATION_LOOKUP } from "./persistence/merchant-location-lookup";
import { DrizzleMerchantLocationLookup } from "./persistence/drizzle-merchant-location-lookup";
import { DevicesBusinessRegionLookup } from "./persistence/drizzle-business-region-lookup";
import { CounterDeviceCredentialVerifier } from "./counter-device-credential-verifier";
import { DeviceAuthorize } from "./device-authorize";

export const DEVICES_DB = Symbol("DEVICES_DB");

/**
 * TASKS.md 8.1: counter devices, their pairing/PIN lifecycle, and the two
 * device-authenticated routes (`device-authorize.ts`).
 *
 * Deliberately imports NEITHER `AuthzModule` nor `StoreModule`, even though
 * this module's own controllers use `AsyncPrincipalResolver`,
 * `StoreDevicePrincipalResolver` and `PDP_CLIENT` (all from `AuthzModule`,
 * which is `@Global()` and so already visible here with no import). The
 * reason is `authz.module.ts`: 8.1.b binds its real
 * `DEVICE_CREDENTIAL_VERIFIER` by importing THIS module, and `StoreModule`
 * itself already imports `AuthzModule` — so this module importing either
 * one back would close a cycle
 * (`AuthzModule -> DevicesModule -> StoreModule -> AuthzModule`, or the
 * shorter `AuthzModule -> DevicesModule -> AuthzModule`). Instead:
 *   - the business's region is read directly off `business_accounts`
 *     (`DevicesBusinessRegionLookup`, a standalone copy of
 *     `store/persistence/drizzle-business-region-lookup.ts` — see its own
 *     comment);
 *   - a location's ownership is read directly off `store.merchant_location`
 *     (`DrizzleMerchantLocationLookup` — a plain table read, not a
 *     `StoreModule` service).
 *
 * `CounterDeviceCredentialVerifier` is exported so `authz.module.ts` can
 * bind it in place of `NoDeviceCredentialVerifier`.
 */
@Module({
  imports: [PdpClientModule, RateLimitModule],
  controllers: [StudioDevicesController, DevicePairingController, DeviceUnlockController],
  providers: [
    {
      provide: DEVICES_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: COUNTER_DEVICE_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleCounterDeviceRepository(db),
      inject: [DEVICES_DB],
    },
    {
      provide: MERCHANT_LOCATION_LOOKUP,
      useFactory: (db: AppDb) => new DrizzleMerchantLocationLookup(db),
      inject: [DEVICES_DB],
    },
    {
      provide: BUSINESS_REGION_LOOKUP,
      useFactory: (db: AppDb) => new DevicesBusinessRegionLookup(db),
      inject: [DEVICES_DB],
    },
    CounterDeviceCredentialVerifier,
    DeviceAuthorize,
  ],
  exports: [COUNTER_DEVICE_REPOSITORY, CounterDeviceCredentialVerifier],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class DevicesModule {}
