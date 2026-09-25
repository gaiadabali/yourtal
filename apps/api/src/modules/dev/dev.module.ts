import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import {
  SIM_OUTBOX_READER,
  PostgresSimOutboxReader,
} from "../../shared/drivers/postgres-sim-outbox-reader";
import { DevInboxController } from "./dev-inbox.controller";

/** 1.6.b. Its own `Pool` rather than sharing `AUTH_DB`'s or another
 * module's — the same reasoning `AuthModule`'s own header gives for
 * `AUTH_DB`: a reviewer-facing read path has no reason to share a
 * connection pool with a domain module's writes. */
@Module({
  controllers: [DevInboxController],
  providers: [
    {
      provide: SIM_OUTBOX_READER,
      useFactory: (config: AppConfig) =>
        new PostgresSimOutboxReader(new Pool({ connectionString: config.databaseUrl })),
      inject: [APP_CONFIG],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class DevModule {}
