import type pg from "pg";

/**
 * Watch's own domain: watch sessions, coverage and completions. 1.3.b split
 * `seed.ts` into one file per domain ahead of that content existing, so
 * Phase 5 (watch and earn) has a place to add it without touching `seed.ts`
 * or anyone else's file.
 *
 * Nothing to seed yet — a watch session is created by a viewer's own
 * `POST /api/watch/sessions` call, not by fixture data, so there is nothing
 * this seed can produce ahead of time that a real request would not.
 */
// `_pool`: kept for the (pool) => Promise<...> signature every domain seed
// shares, so seed.ts's orchestration line reads the same for all five.
export async function seedWatch(_pool: pg.Pool): Promise<void> {
  return Promise.resolve();
}
