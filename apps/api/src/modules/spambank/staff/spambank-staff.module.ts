import { Module } from "@nestjs/common";
import { SpambankModule } from "../spambank.module";
import { SpambankAutoreplyController } from "./spambank-autoreply.controller";
import { SpambankLeadsController } from "./spambank-leads.controller";

/**
 * Spambank's staff API (spambank/BUILD.md 5.4): the leads list and the auto-reply panel. Principal
 * resolution and the audit interceptor are global (`AuthzModule`, `StaffModule`); the mail settings and
 * the raw SQL pool come from `SpambankModule`.
 */
@Module({
  imports: [SpambankModule],
  controllers: [SpambankLeadsController, SpambankAutoreplyController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class SpambankStaffModule {}
