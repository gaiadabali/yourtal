import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { createPool } from "../../shared/persistence/create-pool";

/**
 * The API's own connection pool for Spambank's raw SQL (the webhook's mailbox lookup and the machine
 * routes). Raw `pg`, like the OIDC stores: the ingest code it shares with the worker is plain SQL.
 */
@Injectable()
export class SpambankDb implements OnApplicationShutdown {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = createPool(config.databaseUrl, { max: 5 });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
