import type { Region } from "@yourtal/contracts/region";

export interface ClaimedLinkCode {
  readonly userId: string;
  readonly region: Region;
}

/**
 * Claims 5.4.c's one-time link code for the account it names. A port, not
 * `me`'s own `LinkCodeRepository` (Area B's module, which does not export
 * that token) — same cross-module-read shape
 * `devices/persistence/drizzle-business-region-lookup.ts` already uses for
 * `business.business_accounts`.
 */
export interface LinkCodeLookup {
  /**
   * Marks the code used and returns its account, in one statement, so two
   * concurrent calls cannot both spend it (14.3.b: the code stays
   * single-use). `null` for an unknown, expired or already-used code.
   */
  claim(code: string): Promise<ClaimedLinkCode | null>;
}

export const LINK_CODE_LOOKUP = Symbol("LINK_CODE_LOOKUP");
