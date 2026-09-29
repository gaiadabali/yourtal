/**
 * TASKS.md 12.2.b / F12: a teen's quiet hours are 21:00-07:00 in their OWN
 * profile timezone (`identity.user_profile.timezone`, captured at signup) --
 * never the region's, which is a different notion `feed-data.ts`'s own
 * `REGION_TIME_ZONE` already uses for a different purpose (which calendar
 * day a streak counts for). During quiet hours: no notification is sent to
 * a teen, and `POST /api/watch/sessions` refuses to start a new reward
 * session for one.
 *
 * `now` is a parameter, never read internally (`new Date()` lives at each
 * call site, same convention `RankingContext.now` and
 * `streak-backstop.ts`'s own `runStreakBackstop(db, now)` already follow) --
 * so a caller, a test included, controls exactly what instant this
 * evaluates against without needing a real wall clock to cooperate.
 */
export function isQuietHours(now: Date, timezone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= 21 || hour < 7;
}
