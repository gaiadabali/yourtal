import type pg from "pg";

/**
 * Identity's own domain: demo user accounts, profiles and business
 * memberships. 1.3.b split `seed.ts` into one file per domain ahead of that
 * content existing, so 1.4 (accounts and profile) and later phases have a
 * place to add it without touching `seed.ts` or anyone else's file.
 *
 * Nothing to seed yet — the store and voucher fixtures currently reference a
 * fixed `DEMO_USER_ID` (see `seed/store.ts`) with no backing
 * `identity.user_profile` row, because that table does not exist until 1.4.a.
 */
// `_pool`: kept for the (pool) => Promise<...> signature every domain seed
// shares, so seed.ts's orchestration line reads the same for all five.
export async function seedIdentity(_pool: pg.Pool): Promise<void> {
  return Promise.resolve();
}
