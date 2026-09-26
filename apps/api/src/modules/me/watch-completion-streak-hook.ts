import { Injectable, Logger } from "@nestjs/common";
import type { WatchCompletionEvent, WatchCompletionHook } from "../watch/watch-completion-hook";
import { StreakService } from "./streak.service";

/**
 * 5.5.d's real listener — see `watch-completion-hook.ts`'s own header for
 * the contract. Only ever calls `StreakService.sync`, which already re-reads
 * `watch.session` itself (`CompletedWatchDaysReader`) rather than trusting
 * this event's own fields, so a hook firing slightly stale or twice for the
 * same completion is harmless: `sync`'s row lock (5.5.d) makes a repeat call
 * a no-op the moment the day is already folded in.
 *
 * Never rethrows: `WatchController.complete()` awaits this hook directly,
 * with no try/catch of its own (a session has already completed and granted
 * its reward by the time this fires) — a streak-sync failure must not turn
 * a successful completion into a 500 for the viewer. Logged, not thrown.
 *
 * NOT WIRED IN YET. Registering this class does nothing on its own: it
 * still needs `WatchModule`'s own `{ provide: WATCH_COMPLETION_HOOK, useClass:
 * NoopWatchCompletionHook }` (watch.module.ts) replaced with this class —
 * a change inside `modules/watch`, out of this session's area (this
 * session's own report names the exact one-line diff).
 */
@Injectable()
export class RealWatchCompletionHook implements WatchCompletionHook {
  private readonly logger = new Logger(RealWatchCompletionHook.name);

  constructor(private readonly streaks: StreakService) {}

  async onWatchCompleted(event: WatchCompletionEvent): Promise<void> {
    try {
      await this.streaks.sync(event.userId);
    } catch (error) {
      this.logger.warn(
        `streak sync failed for a real watch completion (user=${event.userId}, ` +
          `session=${event.sessionId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
