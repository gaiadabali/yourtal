import type { Region } from "@yourtal/contracts/region";

/**
 * The hook 5.5.d asks for: something outside this module can react the
 * moment a reward session actually completes AND grants — the streak
 * bonus's own note is exactly this: "there is no watch-completion hook to
 * trigger this from", so 5.5.a computed the streak on READ instead
 * (`GET /api/me/streak`), against `watch.session` rows directly.
 *
 * Deliberately the simplest thing that works rather than a framework event
 * bus: one optional, injectable listener, defaulting to a no-op. Fired
 * once, after `markGranted` — never for a non-earning completion, since a
 * non-earning session did not complete a REWARD session in the sense F12's
 * streak means (docs/06, this ticket's own TASKS.md 5.5.a: "a day counts
 * when it has ≥ 1 COMPLETED REWARD session").
 *
 * ## How to wire the real listener (5.5.d)
 *
 * 1. In `modules/me` (or wherever the streak service lives), implement
 *    `WatchCompletionHook` — call `StreakService`'s existing day-advance
 *    logic (`streak.service.ts`, 5.5.a) with `event.userId`/`event.region`/
 *    `event.completedAt`.
 * 2. Bind it: `{ provide: WATCH_COMPLETION_HOOK, useClass: RealHook }` in
 *    `app.module.ts` (shared, add-only) or in a module that both `WatchModule`
 *    and the streak module import — NOT inside `WatchModule` itself, since
 *    `modules/me` is not something this module may import (it would invert
 *    the dependency: watch is the lower-level module here).
 * 3. `WatchModule`'s own default (`NoopWatchCompletionHook`) stays as the
 *    fallback for any wiring that does not override it, so watch's own
 *    tests never need to know a streak module exists.
 */
export interface WatchCompletionEvent {
  readonly userId: string;
  readonly campaignId: string;
  readonly sessionId: string;
  readonly completedAt: Date;
  readonly region: Region;
}

export interface WatchCompletionHook {
  onWatchCompleted(event: WatchCompletionEvent): Promise<void>;
}

export const WATCH_COMPLETION_HOOK = Symbol("WATCH_COMPLETION_HOOK");

export class NoopWatchCompletionHook implements WatchCompletionHook {
  async onWatchCompleted(): Promise<void> {
    // Nothing registered. Deliberately silent — a session completing with
    // no listener bound is the ordinary case for every test in this module.
  }
}
