import { Inject, Injectable, Module } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { assertUnprivilegedRole } from "./assert-unprivileged-role";

/**
 * Runs the YT-0554 privilege assertion once, at boot, before the app serves
 * anything.
 *
 * `OnApplicationBootstrap` rather than a module factory: the check is a
 * round trip to Postgres, and a `useFactory` that returns a pool does not
 * connect — `new Pool()` is lazy, so a check written there would run at the
 * first query, which is to say after the app has already started reporting
 * itself healthy. The whole point is to refuse to start.
 *
 * Nest lets a throw here abort the bootstrap, which is the behaviour we
 * want: `main.ts` already treats a failed boot as unrecoverable (docs/13b
 * section 4).
 */
@Injectable()
export class DatabaseRoleCheck implements OnApplicationBootstrap {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onApplicationBootstrap(): Promise<void> {
    await assertUnprivilegedRole(this.config.databaseUrl);
  }
}

@Module({
  providers: [DatabaseRoleCheck],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class PersistenceModule {}
