import { z } from "zod";

/**
 * Who a campaign or listing may reach — TASKS.md 1.1.c, the one definition
 * every area builds targeting against.
 *
 * - `all_ages` reaches every account.
 * - `teen` reaches only accounts aged 13-17.
 * - `adult` reaches only 18+.
 * - `parents` reaches 18+, boosted for accounts that have declared the
 *   parent-of-young-children interest (`family-young-children`,
 *   `../interest/taxonomy.ts`) and given ad-targeting consent.
 *
 * Reach and boost are deliberately two different questions. Reach is a hard
 * gate: an item never appears outside the accounts listed above. Boost is a
 * ranking preference among items a viewer can already see, and grants no new
 * visibility on its own — declaring the interest without consent, or having
 * consent without the interest, is still just an adult seeing `parents`
 * content at ordinary rank.
 *
 * Until 12.x ships (`TEEN_ACCOUNTS` flag, off everywhere today), no account
 * is ever `teen` — see `packages/jurisdiction`'s age policy — so `reachesAudience`
 * is written to hold once teen accounts exist rather than to special-case
 * their absence.
 */
export const audienceSchema = z.enum(["all_ages", "teen", "adult", "parents"]);
export type Audience = z.infer<typeof audienceSchema>;

/** Computed from date of birth when an account is read, never stored — see `identity.user_profile` (1.4.a). */
export type AgeBand = "teen" | "adult";

export interface AudienceReachContext {
  readonly ageBand: AgeBand;
  /** Declared only, never derived from receipts (1.1.e, docs/20 §9). */
  readonly hasParentOfYoungChildrenInterest: boolean;
  readonly hasAdTargetingConsent: boolean;
}

/**
 * Whether an item carrying `audience` may be shown to this viewer at all.
 *
 * "Adults see all_ages, adult and parents. Teens see all_ages and teen, with
 * teen items boosted" (TASKS.md 1.1.c) — the boost is `isBoostedForParents`
 * below, a ranking signal, not a second gate.
 */
export function reachesAudience(
  audience: Audience,
  context: Pick<AudienceReachContext, "ageBand">,
): boolean {
  switch (audience) {
    case "all_ages":
      return true;
    case "teen":
      return context.ageBand === "teen";
    case "adult":
    case "parents":
      return context.ageBand === "adult";
  }
}

/**
 * Whether a `parents`-audience item should rank higher for this viewer.
 * Never widens reach — an adult with neither the interest nor consent still
 * sees `parents` content, just unboosted.
 */
export function isBoostedForParents(context: AudienceReachContext): boolean {
  return (
    context.ageBand === "adult" &&
    context.hasParentOfYoungChildrenInterest &&
    context.hasAdTargetingConsent
  );
}
