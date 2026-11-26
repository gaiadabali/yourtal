import { Inject, Module } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { createPool } from "../../shared/persistence/create-pool";
import { OidcClientRateLimitGuard } from "../oidc/client-rate-limit.guard";
import { OidcModule } from "../oidc/oidc.module";
import { SpambankClientGuard } from "../oidc/teen-invite-client.guard";
import { SpambankClientPersonResolver } from "./client-person";
import { SpambankClientsController } from "./controllers/oidc-clients.controller";
import { SpambankMeController } from "./controllers/me.controller";
import { SPAMBANK_LOCK_POOL, SPAMBANK_MAILBOX_STORE, SPAMBANK_PG_POOL } from "./management.tokens";
import { createPgMailboxStore } from "./persistence/mailbox.store";
import { SpambankManagementService } from "./spambank-management.service";
import { SpambankModule } from "./spambank.module";

/**
 * Spambank's management API (spambank/BUILD.md section 5.1, 5.2): switch a mailbox on, get a mail
 * token, manage app passwords, delete the mailbox. Two doors, one set of use-cases: a signed-in
 * person (`/api/spambank/me`, Cerbos) and an app's server (`/api/oidc-clients/spambank`, a
 * client-credentials token). Kept apart from `SpambankModule`, which stays the driver and the
 * settings every part of Spambank reads.
 */
@Module({
  imports: [SpambankModule, OidcModule],
  controllers: [SpambankMeController, SpambankClientsController],
  providers: [
    {
      provide: SPAMBANK_PG_POOL,
      useFactory: (config: AppConfig): Pool => createPool(config.databaseUrl, { max: 5 }),
      inject: [APP_CONFIG],
    },
    {
      provide: SPAMBANK_LOCK_POOL,
      useFactory: (config: AppConfig): Pool => createPool(config.databaseUrl, { max: 5 }),
      inject: [APP_CONFIG],
    },
    {
      provide: SPAMBANK_MAILBOX_STORE,
      useFactory: (pool: Pool, lockPool: Pool) => createPgMailboxStore(pool, lockPool),
      inject: [SPAMBANK_PG_POOL, SPAMBANK_LOCK_POOL],
    },
    SpambankManagementService,
    SpambankClientPersonResolver,
    SpambankClientGuard,
    OidcClientRateLimitGuard,
  ],
})
export class SpambankManagementModule implements OnApplicationShutdown {
  constructor(
    @Inject(SPAMBANK_PG_POOL) private readonly pool: Pool,
    @Inject(SPAMBANK_LOCK_POOL) private readonly lockPool: Pool,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.pool.end(), this.lockPool.end()]);
  }
}
