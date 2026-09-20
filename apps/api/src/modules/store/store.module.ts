import { Module } from "@nestjs/common";
import { AuthzModule } from "../../shared/authz/authz.module";
import { PdpClientModule } from "../../shared/pdp/pdp-client.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { StoreCatalogueController } from "./store-catalogue.controller";
import { StoreListingController } from "./store-listing.controller";
import { DrizzleListingPriceRevisionRepository } from "./persistence/drizzle-listing-price-revision.repository";
import { DrizzleListingRepository } from "./persistence/drizzle-listing.repository";
import { LISTING_PRICE_REVISION_REPOSITORY } from "./persistence/listing-price-revision.repository";
import { LISTING_REPOSITORY } from "./persistence/listing.repository";

export const STORE_DB = Symbol("STORE_DB");

/**
 * The catalogue backend: listing management (create/edit/pause/retire,
 * quantity and per-user limits, settlement-value repricing with an audit
 * trail) and the public browse/offer-detail surface. YT-0130/YT-0131/YT-0132
 * backend halves.
 *
 * Postgres-backed from the first line, following YT-0552/YT-0553's rule: no
 * in-memory repository exists, not even behind a flag, because a fallback is
 * the thing tests quietly select.
 *
 * ## What this module deliberately does not do
 *
 * It never computes a points price. `points_price = S / B` needs the
 * ledger's backing rate `B`, and `yourtal_app` — the role this module
 * connects as — has no grant on the `ledger` schema at all
 * (`REVOKE ALL ON SCHEMA ledger FROM yourtal_app`,
 * infra/postgres/init/01-schemas.sql). That is enforced by the database, not
 * by this module choosing to be polite about it: widening that grant to make
 * pricing convenient here would be the exact hole docs/09's pricing model
 * exists to close. See `use-cases/set-settlement-value.use-case.ts` and this
 * module's migration for where that leaves a deliberate seam.
 *
 * It also has no burn-saga (reserve stock -> debit points -> issue voucher
 * -> confirm) endpoints. That needs the ledger reachable over HTTP, which is
 * a separate, concurrently-built piece of work — see the ticket report.
 */
@Module({
  imports: [AuthzModule, PdpClientModule],
  controllers: [StoreListingController, StoreCatalogueController],
  providers: [
    {
      provide: STORE_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: LISTING_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleListingRepository(db),
      inject: [STORE_DB],
    },
    {
      provide: LISTING_PRICE_REVISION_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleListingPriceRevisionRepository(db),
      inject: [STORE_DB],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class StoreModule {}
