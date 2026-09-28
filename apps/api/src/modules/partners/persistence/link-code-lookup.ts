import type { Region } from "@yourtal/contracts/region";

export interface ResolvedLinkCode {
  readonly userId: string;
  readonly region: Region;
}

/**
 * Resolves 5.4.c's one-time link code to the account it names. A port, not
 * `me`'s own `LinkCodeRepository` (Area B's module, which does not export
 * that token) — same cross-module-read shape
 * `devices/persistence/drizzle-business-region-lookup.ts` already uses for
 * `business.business_accounts`.
 */
export interface LinkCodeLookup {
  /** `null` for an unknown or expired code. Does not consume it — see partner-actions.controller.ts's own comment on why. */
  resolve(code: string): Promise<ResolvedLinkCode | null>;
}

export const LINK_CODE_LOOKUP = Symbol("LINK_CODE_LOOKUP");
