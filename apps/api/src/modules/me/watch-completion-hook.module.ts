import { Module } from "@nestjs/common";
import { WATCH_COMPLETION_HOOK } from "../watch/watch-completion-hook";
import { MeModule } from "./me.module";
import { RealWatchCompletionHook } from "./watch-completion-streak-hook";

/**
 * 5.5.d's binding point. `WatchModule` may not import `MeModule` directly
 * (`watch-completion-hook.ts`'s own header: watch is the lower-level
 * module here), so this is the neutral module in between — it imports
 * `MeModule` for `StreakService`, and is what `WatchModule` imports instead
 * of providing `NoopWatchCompletionHook` locally.
 *
 * NOT wired into `WatchModule` yet — see this session's report for the
 * exact (out-of-area) change `watch.module.ts` still needs.
 */
@Module({
  imports: [MeModule],
  providers: [{ provide: WATCH_COMPLETION_HOOK, useClass: RealWatchCompletionHook }],
  exports: [WATCH_COMPLETION_HOOK],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class WatchCompletionHookModule {}
