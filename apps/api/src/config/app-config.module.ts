import { Global, Module } from "@nestjs/common";
import { loadAppConfig } from "./app-config";
import type { AppConfig } from "./app-config";

export const APP_CONFIG = Symbol("APP_CONFIG");

/**
 * Parses `process.env` exactly once at bootstrap and hands the same frozen
 * object to every module via DI. `@Global` because config is the one thing
 * every module legitimately needs — the alternative is re-importing this
 * module everywhere, which buys nothing.
 */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadAppConfig() }],
  exports: [APP_CONFIG],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class AppConfigModule {}
