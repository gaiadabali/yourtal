import { Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { PgBoss } from "pg-boss";
import { createApiQueueClient } from "../../shared/queue/create-api-queue-client";
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
import { createVoucherClient } from "../../shared/voucher-client/create-voucher-client";
import { VOUCHER_INTERNAL_CLIENT } from "../../shared/voucher-client/voucher-internal-client";
import { AUTHORIZATION_META_REPOSITORY } from "./persistence/authorization-meta.repository";
import { DrizzleAuthorizationMetaRepository } from "./persistence/drizzle-authorization-meta.repository";
import { CAPTURE_LOG_REPOSITORY } from "./persistence/capture-log.repository";
import { DrizzleCaptureLogRepository } from "./persistence/drizzle-capture-log.repository";
import { CounterController } from "./counter/counter.controller";
import { StudioRedemptionsController } from "./studio-redemptions.controller";
import { StudioDevelopersController } from "./studio-developers.controller";
import { DEVELOPER_CREDENTIAL_REPOSITORY } from "./developers/persistence/developer-credential.repository";
import { DrizzleDeveloperCredentialRepository } from "./developers/persistence/drizzle-developer-credential.repository";
import { WEBHOOK_SUBSCRIPTION_REPOSITORY } from "./developers/persistence/webhook-subscription.repository";
import { DrizzleWebhookSubscriptionRepository } from "./developers/persistence/drizzle-webhook-subscription.repository";
import {
  WEBHOOK_SECRET_ENCRYPTION_KEY,
  requireWebhookSecretEncryptionKey,
} from "./developers/webhook-secret-encryption-key";
import {
  WEBHOOK_EVENT_PUBLISHER,
  PgBossWebhookEventPublisher,
} from "./developers/webhook-event-publisher";
import { DEVICES_DB } from "./devices.tokens";

export { DEVICES_DB };

const DEVICES_QUEUE_CLIENT = Symbol("DEVICES_QUEUE_CLIENT");

/** Same shutdown discipline `studio.module.ts`'s own pg-boss client uses — a process that starts a pool closes it. */
@Injectable()
class DevicesQueueShutdown implements OnApplicationShutdown {
  constructor(private readonly boss: PgBoss) {}

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ close: true, graceful: false, timeout: 1_000 });
  }
}

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
  controllers: [
    StudioDevicesController,
    DevicePairingController,
    DeviceUnlockController,
    CounterController,
    StudioRedemptionsController,
    StudioDevelopersController,
  ],
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
    {
      provide: VOUCHER_INTERNAL_CLIENT,
      // Its own client/pool, not WalletModule's (Area A's module) — see this
      // file's own header on why this module imports neither AuthzModule
      // nor StoreModule; the same reasoning keeps this edge out too.
      useFactory: (config: AppConfig, db: AppDb) => createVoucherClient(config, db),
      inject: [APP_CONFIG, DEVICES_DB],
    },
    {
      provide: AUTHORIZATION_META_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleAuthorizationMetaRepository(db),
      inject: [DEVICES_DB],
    },
    {
      provide: CAPTURE_LOG_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleCaptureLogRepository(db),
      inject: [DEVICES_DB],
    },
    {
      provide: DEVELOPER_CREDENTIAL_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleDeveloperCredentialRepository(db),
      inject: [DEVICES_DB],
    },
    {
      provide: WEBHOOK_SUBSCRIPTION_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleWebhookSubscriptionRepository(db),
      inject: [DEVICES_DB],
    },
    {
      provide: WEBHOOK_SECRET_ENCRYPTION_KEY,
      useFactory: requireWebhookSecretEncryptionKey,
    },
    {
      provide: DEVICES_QUEUE_CLIENT,
      useFactory: async (config: AppConfig): Promise<PgBoss> => {
        const boss = createApiQueueClient(config.databaseUrl);
        await boss.start();
        return boss;
      },
      inject: [APP_CONFIG],
    },
    {
      provide: DevicesQueueShutdown,
      useFactory: (boss: PgBoss): DevicesQueueShutdown => new DevicesQueueShutdown(boss),
      inject: [DEVICES_QUEUE_CLIENT],
    },
    {
      provide: WEBHOOK_EVENT_PUBLISHER,
      useFactory: (boss: PgBoss) => new PgBossWebhookEventPublisher(boss),
      inject: [DEVICES_QUEUE_CLIENT],
    },
    CounterDeviceCredentialVerifier,
    DeviceAuthorize,
  ],
  exports: [COUNTER_DEVICE_REPOSITORY, CounterDeviceCredentialVerifier],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class DevicesModule {}
