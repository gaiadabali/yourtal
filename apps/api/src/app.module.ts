import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AppConfigModule } from "./config/app-config.module";
import { BusinessModule } from "./modules/business/business.module";
import { CampaignModule } from "./modules/campaign/campaign.module";
import { StoreModule } from "./modules/store/store.module";
import { WatchModule } from "./modules/watch/watch.module";
import { AuthzModule } from "./shared/authz/authz.module";
import { PdpGuard } from "./shared/authz/pdp.guard";
import { HealthModule } from "./shared/health/health.module";
import { IdempotencyInterceptor } from "./shared/idempotency/idempotency.interceptor";
import { IdempotencyModule } from "./shared/idempotency/idempotency.module";
import { PdpClientModule } from "./shared/pdp/pdp-client.module";
import { PersistenceModule } from "./shared/persistence/persistence.module";

@Module({
  imports: [
    AppConfigModule,
    PdpClientModule,
    AuthzModule,
    IdempotencyModule,
    // Refuses to boot as a Postgres superuser (YT-0554). Early in the list
    // so the refusal happens before modules that open pools.
    PersistenceModule,
    HealthModule,
    BusinessModule,
    CampaignModule,
    StoreModule,
    WatchModule,
  ],
  // Global rather than per-controller: a new module inherits idempotency
  // instead of having to remember it. It acts only on routes carrying
  // @Idempotent, and mutating-routes.test.ts is what ensures none is missing.
  providers: [
    // Guard before interceptor, which is the order docs/13a specifies:
    // auth -> Cerbos -> idempotency -> module. An unauthenticated caller
    // must not reach the idempotency table at all, or they could poison a
    // key and have a legitimate request replay their stored response.
    { provide: APP_GUARD, useClass: PdpGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class AppModule {}
