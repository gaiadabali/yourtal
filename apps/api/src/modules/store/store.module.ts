import { Module } from "@nestjs/common";
import { AuthzModule } from "../../shared/authz/authz.module";
import { PdpClientModule } from "../../shared/pdp/pdp-client.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { SettlementDecreaseController } from "./settlement-decrease.controller";
import { StoreCatalogueController } from "./store-catalogue.controller";
import { StoreListingController } from "./store-listing.controller";
import { StoreLocationController } from "./store-location.controller";
import { VoucherBatchRequestController } from "./voucher-batch-request.controller";
import { DrizzleListingPriceRevisionRepository } from "./persistence/drizzle-listing-price-revision.repository";
import { DrizzleListingRepository } from "./persistence/drizzle-listing.repository";
import { DrizzleLocationRepository } from "./persistence/drizzle-location.repository";
import { DrizzleSettlementDecreaseRequestRepository } from "./persistence/drizzle-settlement-decrease-request.repository";
import { DrizzleVoucherBatchRequestRepository } from "./persistence/drizzle-voucher-batch-request.repository";
import { DrizzleBusinessRegionLookup } from "./persistence/drizzle-business-region-lookup";
import { BUSINESS_REGION_LOOKUP } from "./persistence/business-region-lookup";
import { LISTING_PRICE_REVISION_REPOSITORY } from "./persistence/listing-price-revision.repository";
import { LISTING_REPOSITORY } from "./persistence/listing.repository";
import { LOCATION_REPOSITORY } from "./persistence/location.repository";
import { SETTLEMENT_DECREASE_REQUEST_REPOSITORY } from "./persistence/settlement-decrease-request.repository";
import { VOUCHER_BATCH_REQUEST_REPOSITORY } from "./persistence/voucher-batch-request.repository";
import { WalletModule } from "../wallet/wallet.module";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";

export const STORE_DB = Symbol("STORE_DB");

/**
 * The catalogue backend: listing management (create/edit/pause/retire,
 * quantity and per-user limits, settlement-value repricing with an audit
 * trail) and the public browse/offer-detail surface. YT-0130/YT-0131/YT-0132
 * backend halves, plus YT-0574/YT-0575: the direct-apply
 * `set_settlement_value` path refuses a material decrease outright, and
 * `SettlementDecreaseController` is where that refusal has somewhere to
 * go — propose, then a second person approves.
 *
 * Postgres-backed from the first line, following YT-0552/YT-0553's rule: no
 * in-memory repository exists, not even behind a flag, because a fallback is
 * the thing tests quietly select.
 *
 * ## Pricing (7.4.b, EM-01)
 *
 * `yourtal_app` still has no grant on the `ledger` schema at all (`REVOKE
 * ALL ON SCHEMA ledger FROM yourtal_app`), so this module still cannot
 * compute `points_price = S / B` itself. Since 4.9 it instead ASKS the
 * ledger, over `LEDGER_INTERNAL_CLIENT` (`ledger-client.priceListing`) —
 * never accepts a price the caller supplies. `create-listing.schema.ts` no
 * longer takes `priceInPoints` at all. See `drizzle-listing.repository.ts`
 * and `apply-settlement-value-change.ts` for the two places this is called.
 *
 * It still has no burn-saga (reserve stock -> debit points -> issue voucher
 * -> confirm) endpoints; that lives in `checkout` (Phase 4).
 */
@Module({
  imports: [AuthzModule, PdpClientModule, WalletModule],
  controllers: [
    StoreListingController,
    StoreLocationController,
    StoreCatalogueController,
    SettlementDecreaseController,
    VoucherBatchRequestController,
  ],
  providers: [
    {
      provide: STORE_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: LISTING_REPOSITORY,
      // 7.4.b: the ledger client (WalletModule already opens one) prices a
      // listing on create and on every settlement-value change -- see
      // apply-settlement-value-change.ts.
      useFactory: (db: AppDb, ledger: LedgerInternalClient) => new DrizzleListingRepository(db, ledger),
      inject: [STORE_DB, LEDGER_INTERNAL_CLIENT],
    },
    {
      provide: LISTING_PRICE_REVISION_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleListingPriceRevisionRepository(db),
      inject: [STORE_DB],
    },
    {
      provide: SETTLEMENT_DECREASE_REQUEST_REPOSITORY,
      useFactory: (db: AppDb, ledger: LedgerInternalClient) =>
        new DrizzleSettlementDecreaseRequestRepository(db, ledger),
      inject: [STORE_DB, LEDGER_INTERNAL_CLIENT],
    },
    {
      provide: LOCATION_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleLocationRepository(db),
      inject: [STORE_DB],
    },
    {
      provide: VOUCHER_BATCH_REQUEST_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleVoucherBatchRequestRepository(db),
      inject: [STORE_DB],
    },
    {
      provide: BUSINESS_REGION_LOOKUP,
      useFactory: (db: AppDb) => new DrizzleBusinessRegionLookup(db),
      inject: [STORE_DB],
    },
  ],
  // BUSINESS_REGION_LOOKUP is exported so PdpGuard (declared in app.module.ts,
  // which imports this module) can inject it for 1.5.b's F2 region wall —
  // additive, changes nothing for this module's own existing consumers.
  exports: [BUSINESS_REGION_LOOKUP],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class StoreModule {}
