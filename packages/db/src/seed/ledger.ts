import type pg from "pg";

/**
 * Ledger's own domain: balances, allocations and points history. 1.3.b
 * split `seed.ts` into one file per domain ahead of that content existing,
 * so Phase 4 (the bank) has a place to add it without touching `seed.ts` or
 * anyone else's file.
 *
 * Nothing to seed yet — the ledger has no live routes until 4.1, and
 * `LEDGER_MODE=fake` (1.2.d) keeps its own state in `platform.ledger_fake_*`
 * tables rather than data this seed would write.
 */
// `_pool`: kept for the (pool) => Promise<...> signature every domain seed
// shares, so seed.ts's orchestration line reads the same for all five.
export async function seedLedger(_pool: pg.Pool): Promise<void> {
  return Promise.resolve();
}
