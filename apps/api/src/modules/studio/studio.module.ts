import { Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { PgBoss } from "pg-boss";
import { createQueueClient } from "@yourtal/queue/client";
import { AuthzModule } from "../../shared/authz/authz.module";
import { PdpClientModule } from "../../shared/pdp/pdp-client.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { MediaController, MediaInternalController } from "./media/media.controller";
import { MediaService, MEDIA_QUEUE_CLIENT } from "./media/media.service";
import { MEDIA_ASSET_REPOSITORY } from "./media/persistence/media-asset.repository";
import type { StudioMediaDb } from "./media/persistence/drizzle-client";
import { createStudioMediaDb } from "./media/persistence/drizzle-client";
import { DrizzleMediaAssetRepository } from "./media/persistence/drizzle-media-asset.repository";

const STUDIO_MEDIA_DB = Symbol("STUDIO_MEDIA_DB");

/** Closes the pg-boss connection pool on shutdown — same shape `dev.module.ts`'s own uses. */
@Injectable()
class MediaQueueShutdown implements OnApplicationShutdown {
  constructor(private readonly boss: PgBoss) {}

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ close: true, graceful: false, timeout: 1_000 });
  }
}

/**
 * Studio's media pipeline (TASKS.md 7.2). The rest of `modules/studio/**`
 * (campaign authoring, 7.3) is a different session's files in this phase
 * split — this module owns only `media/**`.
 *
 * Its own pg-boss client, same reasoning `DevModule`'s header gives for its
 * own: `MediaService.complete()` is the one place `apps/api` itself sends a
 * job outside `/dev/clock` — every other job is worker-to-worker.
 */
@Module({
  imports: [AuthzModule, PdpClientModule],
  controllers: [MediaController, MediaInternalController],
  providers: [
    MediaService,
    {
      provide: STUDIO_MEDIA_DB,
      useFactory: (config: AppConfig): StudioMediaDb => createStudioMediaDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: MEDIA_ASSET_REPOSITORY,
      useFactory: (db: StudioMediaDb) => new DrizzleMediaAssetRepository(db),
      inject: [STUDIO_MEDIA_DB],
    },
    {
      provide: MEDIA_QUEUE_CLIENT,
      useFactory: async (config: AppConfig): Promise<PgBoss> => {
        const boss = createQueueClient({ databaseUrl: config.databaseUrl });
        await boss.start();
        return boss;
      },
      inject: [APP_CONFIG],
    },
    {
      provide: MediaQueueShutdown,
      useFactory: (boss: PgBoss): MediaQueueShutdown => new MediaQueueShutdown(boss),
      inject: [MEDIA_QUEUE_CLIENT],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class StudioModule {}
