import { Module, type OnApplicationShutdown } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { createQueueClient } from "@yourtal/queue/client";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import {
  SIM_OUTBOX_READER,
  PostgresSimOutboxReader,
} from "../../shared/drivers/postgres-sim-outbox-reader";
import { DevInboxController } from "./dev-inbox.controller";
import { DevClockController } from "./dev-clock.controller";
import { DEV_CLOCK_DB_POOL, DEV_CLOCK_QUEUE_CLIENT, DevClockService } from "./dev-clock.service";

/** Closes the pg-boss connection pool on shutdown — same reasoning
 * `RedisClientShutdown` gives for Valkey: a process that starts a pool
 * should be the one that stops it. */
@Injectable()
class DevClockQueueShutdown implements OnApplicationShutdown {
  constructor(private readonly boss: PgBoss) {}

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ close: true, graceful: false, timeout: 1_000 });
  }
}

/** 1.6.b, 2.3.d. Its own `Pool` rather than sharing `AUTH_DB`'s or another
 * module's — the same reasoning `AuthModule`'s own header gives for
 * `AUTH_DB`: a reviewer-facing read/write path has no reason to share a
 * connection pool with a domain module's writes. Its own pg-boss client too
 * (`createQueueClient`, `@yourtal/queue/client`): `/dev/clock`'s "run job
 * now" is the one place `apps/api` itself sends a job, everywhere else that
 * is `apps/worker`'s job. */
@Module({
  controllers: [DevInboxController, DevClockController],
  providers: [
    {
      provide: SIM_OUTBOX_READER,
      useFactory: (config: AppConfig) =>
        new PostgresSimOutboxReader(new Pool({ connectionString: config.databaseUrl })),
      inject: [APP_CONFIG],
    },
    {
      provide: DEV_CLOCK_DB_POOL,
      useFactory: (config: AppConfig): Pool => new Pool({ connectionString: config.databaseUrl }),
      inject: [APP_CONFIG],
    },
    {
      provide: DEV_CLOCK_QUEUE_CLIENT,
      useFactory: async (config: AppConfig): Promise<PgBoss> => {
        const boss = createQueueClient({ databaseUrl: config.databaseUrl });
        await boss.start();
        return boss;
      },
      inject: [APP_CONFIG],
    },
    {
      provide: DevClockQueueShutdown,
      useFactory: (boss: PgBoss): DevClockQueueShutdown => new DevClockQueueShutdown(boss),
      inject: [DEV_CLOCK_QUEUE_CLIENT],
    },
    DevClockService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class DevModule {}
