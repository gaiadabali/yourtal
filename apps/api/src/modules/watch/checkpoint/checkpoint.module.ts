import { Module } from "@nestjs/common";
import { AuthzModule } from "../../../shared/authz/authz.module";
import { PdpClientModule } from "../../../shared/pdp/pdp-client.module";
import { CampaignModule, CAMPAIGN_DB } from "../../campaign/campaign.module";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { WatchModule } from "../watch.module";
import { CheckpointController } from "./checkpoint.controller";
import { CheckpointService } from "./checkpoint.service";
import {
  CHECKPOINT_ISSUE_REPOSITORY,
  DrizzleCheckpointIssueRepository,
} from "./persistence/checkpoint-issue.repository";
import {
  CHECKPOINT_NONCE_REPOSITORY,
  DrizzleCheckpointNonceRepository,
} from "./persistence/checkpoint-nonce.repository";
import { QUESTION_BANK_REPOSITORY, DrizzleQuestionBankRepository } from "../question/question-bank.repository";
import {
  QUESTION_ANSWER_REPOSITORY,
  DrizzleQuestionAnswerRepository,
} from "../question/question-answer.repository";

/**
 * Checkpoint token issuance. YT-0121.
 *
 * Imports `WatchModule` for its session repository rather than constructing
 * a second one, for the reason that module's own header gives: a second way
 * to read a fact is a second place it can be wrong.
 *
 * ## `CHECKPOINT_TOKEN_SECRET` had to reach four places, in order
 *
 * Registering this module makes every boot need the signing key, so the key
 * had to exist everywhere the app boots before the module could join
 * `AppModule`. The variable is REQUIRED in `env.schema.ts` with no default —
 * a signing key with a default is a key every reader of the repository
 * holds — which means a missing one is a failed boot rather than a forgeable
 * token.
 *
 * The order, because getting it wrong breaks other sessions' suites for a
 * reason invisible from their own work:
 *
 * 1. `apps/api/vitest.config.ts` (yourtal-08, under YT-0558) — as a
 *    `??` fallback, never a bare assignment, so a value passed on the
 *    command line still wins.
 * 2. `.env.example` — for `pnpm dev`.
 * 3. `.github/workflows/integration.yml`'s job-level `env:` — **CI does not
 *    read `.env.example`**, so anything booting the app outside the vitest
 *    env would have failed on a missing variable and read as "someone broke
 *    the build". Caught by yourtal-08 before it happened.
 * 4. Here.
 */
@Module({
  imports: [AuthzModule, PdpClientModule, CampaignModule, WatchModule],
  controllers: [CheckpointController],
  providers: [
    CheckpointService,
    {
      provide: CHECKPOINT_NONCE_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleCheckpointNonceRepository(db),
      inject: [CAMPAIGN_DB],
    },
    {
      provide: CHECKPOINT_ISSUE_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleCheckpointIssueRepository(db),
      inject: [CAMPAIGN_DB],
    },
    {
      provide: QUESTION_BANK_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleQuestionBankRepository(db),
      inject: [CAMPAIGN_DB],
    },
    {
      provide: QUESTION_ANSWER_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleQuestionAnswerRepository(db),
      inject: [CAMPAIGN_DB],
    },
    // `CHECKPOINT_SECRET` is provided by `WatchModule` (5.2: `WatchController`
    // needs the same secret to compute a session's schedule LENGTH for its
    // own `questionsAnswered` gate, so the token now lives where both
    // controllers can reach it — see that module's own comment).
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class CheckpointModule {}
