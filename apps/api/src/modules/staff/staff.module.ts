import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Pool } from "pg";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { SettingsModule } from "../../shared/settings/settings.module";
import { WalletModule } from "../wallet/wallet.module";
import { StoreModule } from "../store/store.module";
import { StaffConsoleController } from "./staff-console.controller";
import { StaffUsersController } from "./staff-users.controller";
import { StaffDisputesController } from "./staff-disputes.controller";
import { StaffRiskQueueController } from "./staff-risk-queue.controller";
import { StaffEconomyController } from "./economy/staff-economy.controller";
import { StaffAuditInterceptor } from "./staff-audit.interceptor";
import { UserAccountAttributeLoader } from "./user-account-attribute-loader";
import {
  PostgresStaffAuditRepository,
  STAFF_AUDIT_REPOSITORY,
  STAFF_DB_POOL,
} from "./persistence/staff-audit.repository";
import { PostgresStaffDirectory, STAFF_DIRECTORY } from "./persistence/staff-directory";
import {
  PostgresStaffUserDirectory,
  STAFF_USER_DIRECTORY,
} from "./persistence/staff-user-directory";
import {
  PostgresStaffSuspensionRepository,
  STAFF_SUSPENSION_REPOSITORY,
} from "./persistence/staff-suspension-repository";
import { PostgresStaffDisputeQueue, STAFF_DISPUTE_QUEUE } from "./persistence/staff-dispute-queue";
import {
  PostgresStaffDisputeResolution,
  STAFF_DISPUTE_RESOLUTION,
} from "./persistence/staff-dispute-resolution";
import {
  ECONOMY_PROPOSAL_REPOSITORY,
  PostgresEconomyProposalRepository,
} from "./economy/persistence/economy-proposal.repository";

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
  imports: [WalletModule, SettingsModule, StoreModule],
  controllers: [
    StaffConsoleController,
    StaffUsersController,
    StaffDisputesController,
    StaffRiskQueueController,
    StaffEconomyController,
  ],
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
    {
      provide: STAFF_USER_DIRECTORY,
      useFactory: (pool: Pool) => new PostgresStaffUserDirectory(pool),
      inject: [STAFF_DB_POOL],
    },
    {
      provide: STAFF_SUSPENSION_REPOSITORY,
      useFactory: (pool: Pool) => new PostgresStaffSuspensionRepository(pool),
      inject: [STAFF_DB_POOL],
    },
    {
      provide: STAFF_DISPUTE_QUEUE,
      useFactory: (pool: Pool) => new PostgresStaffDisputeQueue(pool),
      inject: [STAFF_DB_POOL],
    },
    {
      provide: STAFF_DISPUTE_RESOLUTION,
      useFactory: (pool: Pool) => new PostgresStaffDisputeResolution(pool),
      inject: [STAFF_DB_POOL],
    },
    {
      // 9.5: the economy console's own pending-approvals read model, same
      // pool as the audit trail -- staff tooling shares no connections with
      // a domain module (this file's own header).
      provide: ECONOMY_PROPOSAL_REPOSITORY,
      useFactory: (pool: Pool) => new PostgresEconomyProposalRepository(pool),
      inject: [STAFF_DB_POOL],
    },
    UserAccountAttributeLoader,
    StaffPoolShutdown,
    { provide: APP_INTERCEPTOR, useClass: StaffAuditInterceptor },
  ],
  // `UserAccountAttributeLoader` is consumed by `AppModule`'s
  // RESOURCE_ATTRIBUTE_LOADERS factory (1.5.d's convention -- see that
  // file's own comment), the same reason `WalletModule` exports
  // `WalletAttributeLoader`.
  exports: [UserAccountAttributeLoader],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class StaffModule {}
