import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { seedIdentity } from "./seed/identity";
import { seedLedger } from "./seed/ledger";
import { seedStudio } from "./seed/studio";
import { seedStore } from "./seed/store";
import { seedWatch } from "./seed/watch";

/**
 * Seeds the local database from the same mock generators Phase U renders.
 * YT-0519.
 *
 *   pnpm --filter @yourtal/db seed
 *
 * The point is not test data for its own sake. Phase U has been proving its
 * surfaces against in-process fixtures, which cannot fail the way a database
 * fails — no foreign keys, no check constraints, no round trip through
 * Postgres types. Seeding the real stack turns "works against fixtures" into
 * "works against the stack", and this batch already showed what lives in
 * that gap: a policy that was correct and unreachable, found only by a real
 * request.
 *
 * ## One file per domain (1.3.b)
 *
 * This file used to hold every domain's seed logic directly. It is now a
 * thin orchestrator over `seed/{identity,ledger,watch,studio,store}.ts` —
 * one file per area's own domain, named to match the modules TASKS.md's
 * "Areas and ownership" already splits everything else by. A phase adding
 * seed data for its own domain edits its own file under `seed/`; it does not
 * touch this one, or any other domain's file.
 *
 * ## Mock generators produce independent objects; a database has referential
 * ## integrity, and that difference is the whole job
 *
 * `generateVoucher` invents a `listingId`, a `merchantId` and a face value
 * with no relation to any listing, because nothing in a fixture requires
 * them to agree. Inserted as-is they would violate the foreign key — and if
 * they somehow did not, they would be worse: a voucher for listing L issued
 * by a different merchant, at a face value the listing never offered, is
 * data that no real flow could ever produce. A seeded stack that contains
 * impossible states teaches you nothing, and wastes a day the first time
 * someone debugs against one.
 *
 * So `seed/store.ts`'s vouchers are DERIVED from the listings that were
 * actually inserted, inheriting listing id, merchant, title, face value,
 * redemption policy and — since YT-0502 — one of that listing's own
 * branches. Only the parts that are genuinely the voucher's own (code,
 * owner, issue, expiry) come from the generator.
 *
 * The branch is not optional cosmetics: the database enforces that a
 * voucher's location is one its listing actually offers, so a generated
 * location would be rejected rather than merely odd.
 *
 * ## Idempotent, by primary key — but only for a FIXED contract
 *
 * `ON CONFLICT DO NOTHING`, and the generators are seeded, so ids are stable
 * across runs and re-seeding is a no-op.
 *
 * **That guarantee ends the moment a schema gains a field.** The generators
 * draw from a seeded faker in field order, so adding one property shifts
 * every draw after it — and every id downstream changes. Re-seeding then
 * inserts a whole SECOND catalogue beside the first, because the new ids
 * conflict with nothing. Observed exactly once, when YT-0502 added
 * `locations` to the listing: 30 listings became 60, half of them orphaned
 * from the locations that could only link to the new ids.
 *
 * It looks like idempotency failing and it is not — it is idempotency
 * working on data that is no longer the same data. The keys really are new.
 *
 * So: **after any contract change, `pnpm dev:fresh`, not `pnpm db:seed`.**
 * Seeded data is disposable by design; treating it as durable is what makes
 * this bite. `seed.test.ts` asserts no listing is left without locations,
 * which is the shape this failure takes and the reason it was caught.
 */

const { Pool } = pg;

export interface SeedCounts {
  readonly campaigns: number;
  readonly listings: number;
  readonly vouchers: number;
  readonly questions: number;
}

export async function seed(pool: pg.Pool): Promise<SeedCounts> {
  await seedIdentity(pool);
  await seedLedger(pool);
  const { campaigns, questions } = await seedStudio(pool);
  const { listings, vouchers } = await seedStore(pool);
  await seedWatch(pool);
  return { campaigns, listings, vouchers, questions };
}

/** CLI entry point. Kept separate so tests can seed a pool they control. */
/**
 * DATABASE_OWNER_URL from the environment, falling back to the repo's `.env`.
 *
 * The same fallback `scripts/atlas.mjs` has, and for the same reason: `pnpm`
 * does not load `.env`, so without this `pnpm dev:fresh` fails halfway —
 * migrations apply (the migration runner reads the file) and then the seed
 * cannot find a database. A documented command that works for two of its
 * three steps is worse than one that does not exist.
 *
 * The OWNER credential, not the app's. Seeding is administration: since
 * YT-0142 the app role can read a voucher and not write one, so a seed
 * running as the app fails on the first voucher. Widening that grant to suit
 * a fixture would undo a control that exists because voucher issuance is the
 * value path — see `database-urls.ts`.
 */
function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_OWNER_URL !== undefined) return process.env.DATABASE_OWNER_URL;

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const envFile = path.join(repoRoot, ".env");
  if (!existsSync(envFile)) return undefined;

  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*DATABASE_OWNER_URL\s*=\s*(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const connectionString = resolveDatabaseUrl();
  if (connectionString === undefined) {
    console.error(
      "No DATABASE_OWNER_URL. The seed writes fixtures as the owner, not as the app role. " +
        "Copy .env.example to .env and run `pnpm dev:up`.",
    );
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString });
  try {
    const counts = await seed(pool);
    console.log(
      `Seeded ${String(counts.campaigns)} campaigns, ${String(counts.listings)} listings, ` +
        `${String(counts.vouchers)} vouchers, ${String(counts.questions)} questions. ` +
        `Re-running is a no-op; use \`pnpm dev:fresh\` for a clean slate.`,
    );
  } finally {
    await pool.end();
  }
}

// Only when run directly, so importing `seed` from a test does not connect.
if (process.argv[1]?.endsWith("seed.ts") === true) {
  await main();
}
