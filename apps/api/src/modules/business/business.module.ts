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
import { InMemoryBillingContactRepository } from "./persistence/in-memory-billing-contact.repository";
import { InMemoryBusinessAccountRepository } from "./persistence/in-memory-business-account.repository";
import { InMemoryBusinessMemberRepository } from "./persistence/in-memory-business-member.repository";
import { InMemoryBusinessOnboardingUnitOfWork } from "./persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "./persistence/in-memory-business-store";
import { InMemoryKybDocumentRepository } from "./persistence/in-memory-kyb-document.repository";
import { KYB_DOCUMENT_REPOSITORY } from "./persistence/kyb-document.repository";
import { TeamDirectoryController } from "./team-directory.controller";
import { TeamInviteController } from "./team-invite.controller";
import { TeamMemberController } from "./team-member.controller";

const BUSINESS_DB = Symbol("BUSINESS_DB");

/**
 * THE swap point for YT-0022: every repository below picks the Drizzle
 * implementation when `AppConfig.databaseUrl` is set, and the in-memory one
 * otherwise. All in-memory implementations share one `InMemoryBusinessStore`
 * instance so a business created through one repository is visible through
 * the others — see that class's doc comment.
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
      useFactory: (config: AppConfig): BusinessDb | null =>
        config.databaseUrl ? createBusinessDb(config.databaseUrl) : null,
      inject: [APP_CONFIG],
    },
    { provide: InMemoryBusinessStore, useClass: InMemoryBusinessStore },
    {
      provide: BUSINESS_ACCOUNT_REPOSITORY,
      useFactory: (db: BusinessDb | null, store: InMemoryBusinessStore) =>
        db
          ? new DrizzleBusinessAccountRepository(db)
          : new InMemoryBusinessAccountRepository(store),
      inject: [BUSINESS_DB, InMemoryBusinessStore],
    },
    {
      provide: BUSINESS_MEMBER_REPOSITORY,
      useFactory: (db: BusinessDb | null, store: InMemoryBusinessStore) =>
        db ? new DrizzleBusinessMemberRepository(db) : new InMemoryBusinessMemberRepository(store),
      inject: [BUSINESS_DB, InMemoryBusinessStore],
    },
    {
      provide: BILLING_CONTACT_REPOSITORY,
      useFactory: (db: BusinessDb | null, store: InMemoryBusinessStore) =>
        db ? new DrizzleBillingContactRepository(db) : new InMemoryBillingContactRepository(store),
      inject: [BUSINESS_DB, InMemoryBusinessStore],
    },
    {
      provide: KYB_DOCUMENT_REPOSITORY,
      useFactory: (db: BusinessDb | null, store: InMemoryBusinessStore) =>
        db ? new DrizzleKybDocumentRepository(db) : new InMemoryKybDocumentRepository(store),
      inject: [BUSINESS_DB, InMemoryBusinessStore],
    },
    {
      provide: BUSINESS_ONBOARDING_UNIT_OF_WORK,
      useFactory: (db: BusinessDb | null, store: InMemoryBusinessStore) =>
        db
          ? new DrizzleBusinessOnboardingUnitOfWork(db)
          : new InMemoryBusinessOnboardingUnitOfWork(store),
      inject: [BUSINESS_DB, InMemoryBusinessStore],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class BusinessModule {}
