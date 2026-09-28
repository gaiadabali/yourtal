/**
 * TASKS.md 9.3.b: a suspended business's campaigns leave the feed. Reads
 * `business.business_accounts` directly (yourtal_app already has SELECT on
 * it -- see `20260919000003_business.sql`) rather than through
 * `BusinessAccountRepository`: that repository has no batch lookup, and
 * adding one for this single caller would be a wider change to a module
 * this one already avoids depending on (see `feed.module.ts`'s own header
 * on why this module reads everything else through raw SQL, not another
 * module's repository).
 */
export interface SuspendedBusinessLookup {
  /** The subset of `businessIds` whose business is currently suspended. */
  suspendedIds(businessIds: readonly string[]): Promise<ReadonlySet<string>>;
}

export const SUSPENDED_BUSINESS_LOOKUP = Symbol("SUSPENDED_BUSINESS_LOOKUP");
