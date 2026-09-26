import { Module } from "@nestjs/common";
import { AuthzModule } from "../../shared/authz/authz.module";
import { PdpClientModule } from "../../shared/pdp/pdp-client.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { CampaignModule, CAMPAIGN_DB } from "../campaign/campaign.module";
import { IdentityModule } from "../identity/identity.module";
import { WalletModule } from "../wallet/wallet.module";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import {
  DrizzleWatchSessionRepository,
  WATCH_SESSION_REPOSITORY,
} from "./persistence/drizzle-watch-session.repository";
import { WatchController } from "./watch.controller";
import { CampaignViewAttributeLoader } from "./campaign-view-attribute-loader";
import { DELIVERY_COVERAGE_READER, StubDeliveryCoverageReader } from "./delivery-coverage";
import { CHECKPOINT_SECRET } from "./checkpoint/checkpoint.service";
import { REWARD_ATTESTATION_SECRET } from "./reward-attestation-secret";

/**
 * Watch sessions. YT-0553, 5.1-5.3.
 *
 * Imports `CampaignModule` rather than re-reading campaigns itself: a
 * session's duration, terms version and liveness are all facts about a
 * campaign, and a second way to read them is a second place they can be
 * wrong. It reuses that module's database handle for the same reason one
 * pool is better than two.
 *
 * Imports `IdentityModule` (for `USER_PROFILE_REPOSITORY` — region and
 * trust tier, the same pattern `CheckoutController` already uses) and
 * `WalletModule` (for `LEDGER_INTERNAL_CLIENT` — the allocation hold at
 * start, `grantReward` at completion) rather than opening either a second
 * time.
 */
@Module({
  imports: [AuthzModule, PdpClientModule, CampaignModule, IdentityModule, WalletModule],
  controllers: [WatchController],
  providers: [
    {
      provide: WATCH_SESSION_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleWatchSessionRepository(db),
      inject: [CAMPAIGN_DB],
    },
    CampaignViewAttributeLoader,
    {
      provide: REWARD_ATTESTATION_SECRET,
      useFactory: (config: AppConfig): string => {
        const secret = config.ledger.rewardAttestationSecret;
        if (secret === undefined || secret === "") {
          throw new Error(
            "REWARD_ATTESTATION_SECRET is required to sign completion attestations (4.4.c).",
          );
        }
        return secret;
      },
      inject: [APP_CONFIG],
    },
    { provide: DELIVERY_COVERAGE_READER, useClass: StubDeliveryCoverageReader },
    {
      provide: CHECKPOINT_SECRET,
      useFactory: (): string => {
        const secret = process.env.CHECKPOINT_TOKEN_SECRET;
        if (secret === undefined || secret === "") {
          // Fail at boot, not at the first checkpoint. A missing signing key
          // discovered on the request path is a 500 for a viewer who did
          // nothing wrong, and — worse — it is the moment somebody reaches
          // for a default to make the error go away.
          throw new Error(
            "CHECKPOINT_TOKEN_SECRET is required. Checkpoint tokens are signed with it, and a default would be a key every reader of this repository holds.",
          );
        }
        return secret;
      },
    },
  ],
  // Exported so `CheckpointModule` (YT-0121) reads sessions through THIS
  // repository rather than constructing a second one over the same table.
  // Additive: exporting a provider changes nothing for existing consumers,
  // and two repositories over one table is how they drift.
  //
  // `CampaignViewAttributeLoader` is exported so `app.module.ts` can gather
  // it into `RESOURCE_ATTRIBUTE_LOADERS` for the app-wide `PdpGuard` (1.5.d).
  exports: [WATCH_SESSION_REPOSITORY, CampaignViewAttributeLoader, CHECKPOINT_SECRET],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class WatchModule {}
