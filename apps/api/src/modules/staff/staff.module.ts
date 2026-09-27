import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Pool } from "pg";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { StaffConsoleController } from "./staff-console.controller";
import { StaffAuditInterceptor } from "./staff-audit.interceptor";
import {
  PostgresStaffAuditRepository,
  STAFF_AUDIT_REPOSITORY,
  STAFF_DB_POOL,
} from "./persistence/staff-audit.repository";
import { PostgresStaffDirectory, STAFF_DIRECTORY } from "./persistence/staff-directory";

class StaffPoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(STAFF_DB_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * TASKS.md Phase 9: the internal staff console's API. Its own pool, like
 * `DevModule`'s: staff tooling shares no connections with a domain module.
 * The audit interceptor is global but acts only on `@StaffAction` routes.
 */
@Module({
  controllers: [StaffConsoleController],
  providers: [
    {
      provide: STAFF_DB_POOL,
      useFactory: (config: AppConfig): Pool => new Pool({ connectionString: config.databaseUrl }),
      inject: [APP_CONFIG],
    },
    {
      provide: STAFF_AUDIT_REPOSITORY,
      useFactory: (pool: Pool) => new PostgresStaffAuditRepository(pool),
      inject: [STAFF_DB_POOL],
    },
    {
      provide: STAFF_DIRECTORY,
      useFactory: (pool: Pool) => new PostgresStaffDirectory(pool),
      inject: [STAFF_DB_POOL],
    },
    StaffPoolShutdown,
    { provide: APP_INTERCEPTOR, useClass: StaffAuditInterceptor },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class StaffModule {}
