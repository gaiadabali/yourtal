import { Module } from "@nestjs/common";
import { AuthzModule } from "../../shared/authz/authz.module";
import { PdpClientModule } from "../../shared/pdp/pdp-client.module";
import { EmailDriverModule } from "../../shared/drivers/email-driver.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { BillingContactController } from "./billing-contact.controller";
import { BusinessController } from "./business.controller";
import { CreateBusinessController } from "./create-business.controller";
import { EmailInvitationMailer } from "./email-invitation-mailer";
import { INVITATION_MAILER } from "./invitation-mailer";
import { createKybObjectStorage } from "@yourtal/media/kyb-object-storage";
import { KybDocumentController } from "./kyb-document.controller";
import { MyBusinessesController } from "./my-businesses.controller";
import { StaffBusinessReviewController } from "./staff-business-review.controller";
import { KYB_OBJECT_STORAGE } from "./object-storage/kyb-object-storage";
import { ACCEPT_TEAM_INVITATION_UNIT_OF_WORK } from "./persistence/accept-team-invitation.unit-of-work";
import { BILLING_CONTACT_REPOSITORY } from "./persistence/billing-contact.repository";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import { BUSINESS_MEMBER_REPOSITORY } from "./persistence/business-member.repository";
import { BUSINESS_ONBOARDING_UNIT_OF_WORK } from "./persistence/business-onboarding.unit-of-work";
import type { BusinessDb } from "./persistence/drizzle-client";
import { createBusinessDb } from "./persistence/drizzle-client";
import { DrizzleAcceptTeamInvitationUnitOfWork } from "./persistence/drizzle-accept-team-invitation.unit-of-work";
import { DrizzleBillingContactRepository } from "./persistence/drizzle-billing-contact.repository";
import { DrizzleBusinessAccountRepository } from "./persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "./persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "./persistence/drizzle-business-onboarding.unit-of-work";
import { DrizzleKybDocumentRepository } from "./persistence/drizzle-kyb-document.repository";
import { DrizzleTeamInvitationRepository } from "./persistence/drizzle-team-invitation.repository";
import { DrizzleTransferOwnershipUnitOfWork } from "./persistence/drizzle-transfer-ownership.unit-of-work";
import { KYB_DOCUMENT_REPOSITORY } from "./persistence/kyb-document.repository";
import { DrizzleStaffBusinessReviewRepository } from "./persistence/drizzle-staff-business-review.repository";
import { STAFF_BUSINESS_REVIEW_REPOSITORY } from "./persistence/staff-business-review.repository";
import { TEAM_INVITATION_REPOSITORY } from "./persistence/team-invitation.repository";
import { TRANSFER_OWNERSHIP_UNIT_OF_WORK } from "./persistence/transfer-ownership.unit-of-work";
import { TeamDirectoryController } from "./team-directory.controller";
import { TeamInviteController } from "./team-invite.controller";
import { TeamMemberController } from "./team-member.controller";
import { TeamOwnershipController } from "./team-ownership.controller";

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
  imports: [AuthzModule, PdpClientModule, EmailDriverModule],
  controllers: [
    CreateBusinessController,
    BusinessController,
    MyBusinessesController,
    TeamDirectoryController,
    TeamInviteController,
    TeamMemberController,
    TeamOwnershipController,
    BillingContactController,
    KybDocumentController,
    StaffBusinessReviewController,
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
      provide: TEAM_INVITATION_REPOSITORY,
      useFactory: (db: BusinessDb) => new DrizzleTeamInvitationRepository(db),
      inject: [BUSINESS_DB],
    },
    {
      provide: ACCEPT_TEAM_INVITATION_UNIT_OF_WORK,
      useFactory: (db: BusinessDb) => new DrizzleAcceptTeamInvitationUnitOfWork(db),
      inject: [BUSINESS_DB],
    },
    {
      provide: TRANSFER_OWNERSHIP_UNIT_OF_WORK,
      useFactory: (db: BusinessDb) => new DrizzleTransferOwnershipUnitOfWork(db),
      inject: [BUSINESS_DB],
    },
    {
      provide: INVITATION_MAILER,
      useClass: EmailInvitationMailer,
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
      provide: STAFF_BUSINESS_REVIEW_REPOSITORY,
      useFactory: (db: BusinessDb) => new DrizzleStaffBusinessReviewRepository(db),
      inject: [BUSINESS_DB],
    },
    {
      provide: KYB_OBJECT_STORAGE,
      useFactory: (config: AppConfig) => createKybObjectStorage(config.objectStorage),
      inject: [APP_CONFIG],
    },
    {
      provide: BUSINESS_ONBOARDING_UNIT_OF_WORK,
      useFactory: (db: BusinessDb) => new DrizzleBusinessOnboardingUnitOfWork(db),
      inject: [BUSINESS_DB],
    },
  ],
  // TASKS.md 7.3: StudioModule needs a business's own region/isVerified
  // (red line 7's KYB gate on submit) without a second copy of this
  // repository or a cross-schema query of its own.
  exports: [BUSINESS_ACCOUNT_REPOSITORY],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class BusinessModule {}
