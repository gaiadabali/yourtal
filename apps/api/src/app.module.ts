import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AppConfigModule } from "./config/app-config.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BusinessModule } from "./modules/business/business.module";
import { CampaignModule } from "./modules/campaign/campaign.module";
import { StoreModule } from "./modules/store/store.module";
import { WatchModule } from "./modules/watch/watch.module";
import { CheckpointModule } from "./modules/watch/checkpoint/checkpoint.module";
import { DevModule } from "./modules/dev/dev.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { CheckoutModule } from "./modules/checkout/checkout.module";
import { WalletAttributeLoader } from "./modules/wallet/wallet-attribute-loader";
import { AuthzModule } from "./shared/authz/authz.module";
import { PdpGuard } from "./shared/authz/pdp.guard";
import { RESOURCE_ATTRIBUTE_LOADERS } from "./shared/authz/resource-attribute-loader";
import type { ResourceAttributeLoader } from "./shared/authz/resource-attribute-loader";
import { CampaignViewAttributeLoader } from "./modules/watch/campaign-view-attribute-loader";
import { HealthModule } from "./shared/health/health.module";
import { IdempotencyInterceptor } from "./shared/idempotency/idempotency.interceptor";
import { IdempotencyModule } from "./shared/idempotency/idempotency.module";
import { PdpClientModule } from "./shared/pdp/pdp-client.module";
import { PersistenceModule } from "./shared/persistence/persistence.module";
import { RateLimitGuard } from "./shared/rate-limit/rate-limit.guard";
import { RateLimitModule } from "./shared/rate-limit/rate-limit.module";

@Module({
  imports: [
    AppConfigModule,
    PdpClientModule,
    AuthzModule,
    RateLimitModule,
    IdempotencyModule,
    // Refuses to boot as a Postgres superuser (YT-0554). Early in the list
    // so the refusal happens before modules that open pools.
    PersistenceModule,
    HealthModule,
    AuthModule,
    BusinessModule,
    CampaignModule,
    StoreModule,
    WatchModule,
    CheckpointModule,
    DevModule,
    WalletModule,
    CheckoutModule,
  ],
  // Global rather than per-controller: a new module inherits idempotency
  // instead of having to remember it. It acts only on routes carrying
  // @Idempotent, and mutating-routes.test.ts is what ensures none is missing.
  providers: [
    // Guard before interceptor, which is the order docs/13a specifies:
    // auth -> Cerbos -> idempotency -> module. An unauthenticated caller
    // must not reach the idempotency table at all, or they could poison a
    // key and have a legitimate request replay their stored response.
    // Rate limiting first, ahead of PdpGuard: the cheapest refusal. A
    // limiter behind authorization would still pay a principal resolution
    // and a Cerbos round trip for every request in a flood, which bounds
    // the wrong cost. Acts only on routes carrying @RateLimit (YT-0052).
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: PdpGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    // 1.5.d (EW-03): every DB-backed resource-attribute loader, gathered
    // here rather than via NestJS's per-module multi-binding (which does
    // not exist) because `PdpGuard` itself is provided in THIS module — a
    // token it injects must be resolvable from AppModule's own injector,
    // which already has both WatchModule (for the loader) and its
    // dependencies (CampaignModule, imported by WatchModule) in scope.
    // Add a new provider here as new kinds need one.
    {
      provide: RESOURCE_ATTRIBUTE_LOADERS,
      useFactory: (
        campaignView: CampaignViewAttributeLoader,
        wallet: WalletAttributeLoader,
      ): readonly ResourceAttributeLoader[] => [campaignView, wallet],
      inject: [CampaignViewAttributeLoader, WalletAttributeLoader],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class AppModule {}
