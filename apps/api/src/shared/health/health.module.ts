import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

/**
 * No imports beyond Nest's own decorators: `HealthService` reads `APP_CONFIG`
 * from the global `AppConfigModule` (`config/app-config.module.ts`) and talks
 * to Postgres and Cerbos directly, so this module does not need
 * `PdpClientModule` or `BusinessModule` wired in. Kept that way on purpose —
 * a health check that depended on the same module graph it is meant to
 * report on could fail to boot for the reason it exists to surface.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class HealthModule {}
