import { Module } from "@nestjs/common";
import { AuthzModule } from "../../shared/authz/authz.module";
import { PdpClientModule } from "../../shared/pdp/pdp-client.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { BillingContactController } from "./billing-contact.controller";
import { BusinessController } from "./business.controller";
import { CreateBusinessController } from "./create-business.controller";
import { KybDocumentController } from "./kyb-document.controller";
import { BILLING_CONTACT_REPOSITORY } from "./persistence/billing-contact.repository";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import { BUSINESS_MEMBER_REPOSITORY } from "./persistence/business-member.repository";
import { BUSINESS_ONBOARDING_UNIT_OF_WORK } from "./persistence/business-onboarding.unit-of-work";
import type { BusinessDb } from "./persistence/drizzle-client";
import { createBusinessDb } from "./persistence/drizzle-client";
import { DrizzleBillingContactRepository } from "./persistence/drizzle-billing-contact.repository";
import { DrizzleBusinessAccountRepository } from "./persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "./persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "./persistence/drizzle-business-onboarding.unit-of-work";
import { DrizzleKybDocumentRepository } from "./persistence/drizzle-kyb-document.repository";
import { KYB_DOCUMENT_REPOSITORY } from "./persistence/kyb-document.repository";
import { TeamDirectoryController } from "./team-directory.controller";
import { TeamInviteController } from "./team-invite.controller";
import { TeamMemberController } from "./team-member.controller";

const BUSINESS_DB = Symbol("BUSINESS_DB");

/**
 * Every repository is Postgres-backed. YT-0552.
 *
 * This used to branch: Drizzle when `AppConfig.databaseUrl` was set, and an
 * in-memory store otherwise. The effect was that the whole backend could run
 * — and its tests pass — without a single line of SQL ever executing. The
 * in-memory implementations are deleted rather than kept behind a flag,
 * because a fallback is the thing tests quietly select, and a fallback that
 * only engages when configuration is missing engages precisely when nobody
 * is looking.
 *
 * `databaseUrl` is required by `env.schema.ts`, so a misconfigured
 * deployment fails at boot rather than serving fakes. Same rule as the
 * driver seam: `live` without its credential does not fall back either.
 */
@Module({
  imports: [AuthzModule, PdpClientModule],
  controllers: [
    CreateBusinessController,
    BusinessController,
    TeamDirectoryController,
    TeamInviteController,
    TeamMemberController,
    BillingContactController,
    KybDocumentController,
  ],
  providers: [
    {
      provide: BUSINESS_DB,
      useFactory: (config: AppConfig): BusinessDb => createBusinessDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: BUSINESS_ACCOUNT_REPOSITORY,
      useFactory: (db: BusinessDb) => new DrizzleBusinessAccountRepository(db),
      inject: [BUSINESS_DB],
    },
    {
      provide: BUSINESS_MEMBER_REPOSITORY,
      useFactory: (db: BusinessDb) => new DrizzleBusinessMemberRepository(db),
      inject: [BUSINESS_DB],
    },
    {
      provide: BILLING_CONTACT_REPOSITORY,
      useFactory: (db: BusinessDb) => new DrizzleBillingContactRepository(db),
      inject: [BUSINESS_DB],
    },
    {
      provide: KYB_DOCUMENT_REPOSITORY,
      useFactory: (db: BusinessDb) => new DrizzleKybDocumentRepository(db),
      inject: [BUSINESS_DB],
    },
    {
      provide: BUSINESS_ONBOARDING_UNIT_OF_WORK,
      useFactory: (db: BusinessDb) => new DrizzleBusinessOnboardingUnitOfWork(db),
      inject: [BUSINESS_DB],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class BusinessModule {}
