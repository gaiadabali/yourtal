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
import { BusinessModule } from "../business/business.module";
import { CAMPAIGN_DB } from "../campaign/campaign.module";
import { CampaignModule } from "../campaign/campaign.module";
import { WalletModule } from "../wallet/wallet.module";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { CampaignDraftController } from "./campaign-draft.controller";
import { QuestionBankController } from "./question-bank.controller";
import { RewardConfigController } from "./reward-config.controller";
import { StaffCampaignModerationController } from "./staff-campaign-moderation.controller";
import { CAMPAIGN_DRAFT_REPOSITORY } from "./persistence/campaign-draft.repository";
import { DrizzleCampaignDraftRepository } from "./persistence/drizzle-campaign-draft.repository";
import { QUESTION_BANK_REPOSITORY } from "./persistence/question-bank.repository";
import { DrizzleQuestionBankRepository } from "./persistence/drizzle-question-bank.repository";
import { REWARD_CONFIG_REPOSITORY } from "./persistence/reward-config.repository";
import { DrizzleRewardConfigRepository } from "./persistence/drizzle-reward-config.repository";
import { TERMS_VERSION_REPOSITORY } from "./persistence/terms-version.repository";
import { DrizzleTermsVersionRepository } from "./persistence/drizzle-terms-version.repository";
import {
  CAMPAIGN_PUBLISHED_PUBLISHER,
  PgBossCampaignPublishedPublisher,
} from "./campaign-published-publisher";

const STUDIO_MEDIA_DB = Symbol("STUDIO_MEDIA_DB");
const STUDIO_QUEUE_CLIENT = Symbol("STUDIO_QUEUE_CLIENT");

/** Closes the pg-boss connection pool on shutdown — same shape `dev.module.ts`'s own uses. */
@Injectable()
class MediaQueueShutdown implements OnApplicationShutdown {
  constructor(private readonly boss: PgBoss) {}

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ close: true, graceful: false, timeout: 1_000 });
  }
}

/** Same shutdown discipline `dev.module.ts`'s own pg-boss client uses — a process that starts a pool closes it. */
@Injectable()
class StudioQueueShutdown implements OnApplicationShutdown {
  constructor(private readonly boss: PgBoss) {}

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ close: true, graceful: false, timeout: 1_000 });
  }
}

/**
 * `modules/studio/**` — one Nest module for the whole of Phase 7's Studio
 * surface, split by FILE ownership between two sessions rather than by
 * NestJS module: 7.2's media pipeline (`media/**`) and 7.3's campaign
 * authoring (everything else here) each own their own controllers,
 * providers and pg-boss client, merged into this single `@Module` because
 * Nest has no notion of "half a module" — `app.module.ts` imports exactly
 * one `StudioModule`.
 *
 * 7.2's media pipeline: its own pg-boss client, same reasoning `DevModule`'s
 * header gives for its own (`MediaService.complete()` is the one place
 * `apps/api` itself sends a job outside `/dev/clock` — every other job is
 * worker-to-worker), and its own `STUDIO_MEDIA_DB` connection.
 *
 * 7.3's campaign authoring: imports `CampaignModule` for `CAMPAIGN_DB` (the
 * SAME pool, not a second connection to the same tables) and `BusinessModule`
 * for the business's own region/isVerified (`BUSINESS_ACCOUNT_REPOSITORY` is
 * 7.3's one addition to `business.module.ts`; `CAMPAIGN_DB` was already
 * exported). `WalletModule` supplies `LEDGER_INTERNAL_CLIENT` for
 * `listAllocations`/`getSettings` (7.3.c), the same door `BillingModule`
 * already uses it through.
 */
@Module({
  imports: [AuthzModule, PdpClientModule, BusinessModule, CampaignModule, WalletModule],
  controllers: [
    MediaController,
    MediaInternalController,
    CampaignDraftController,
    QuestionBankController,
    RewardConfigController,
    StaffCampaignModerationController,
  ],
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
    {
      provide: CAMPAIGN_DRAFT_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleCampaignDraftRepository(db),
      inject: [CAMPAIGN_DB],
    },
    {
      provide: QUESTION_BANK_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleQuestionBankRepository(db),
      inject: [CAMPAIGN_DB],
    },
    {
      provide: REWARD_CONFIG_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleRewardConfigRepository(db),
      inject: [CAMPAIGN_DB],
    },
    {
      provide: TERMS_VERSION_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleTermsVersionRepository(db),
      inject: [CAMPAIGN_DB],
    },
    {
      provide: STUDIO_QUEUE_CLIENT,
      useFactory: async (config: AppConfig): Promise<PgBoss> => {
        const boss = createQueueClient({ databaseUrl: config.databaseUrl });
        await boss.start();
        return boss;
      },
      inject: [APP_CONFIG],
    },
    {
      provide: StudioQueueShutdown,
      useFactory: (boss: PgBoss): StudioQueueShutdown => new StudioQueueShutdown(boss),
      inject: [STUDIO_QUEUE_CLIENT],
    },
    {
      provide: CAMPAIGN_PUBLISHED_PUBLISHER,
      useFactory: (boss: PgBoss) => new PgBossCampaignPublishedPublisher(boss),
      inject: [STUDIO_QUEUE_CLIENT],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class StudioModule {}
