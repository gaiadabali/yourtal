import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ok } from "neverthrow";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Same push mock as points-unlocked-notify.test.ts: count sends, send nothing. */
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("@yourtal/drivers/push", () => ({
  createSimulatedPush: () => ({ mode: "simulated", send: sendMock }),
}));

import { job, warnExpiringVouchers } from "./voucher-expiring-warn";

/**
 * Real Postgres (with-test-db.mjs), in the fake voucher mode CI runs in: the
 * vouchers are rows of `platform.voucher_fake_voucher`, which the wallet reads
 * the same way. The live-mode SQL differs only in its source table.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
const pool = new Pool({ connectionString: DATABASE_URL });

let listing: { id: string; title: string };

beforeAll(async () => {
  const rows = await pool.query<{ id: string; title: string }>(
    `SELECT id::text, title FROM store.listings ORDER BY id LIMIT 1`,
  );
  const first = rows.rows[0];
  if (first === undefined) throw new Error("expected at least one seeded listing");
  listing = first;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue(ok({ id: "mock-push-id" }));
});

async function seedProfile(userId: string, dateOfBirth: string, region = "AU"): Promise<void> {
  await pool.query(
    `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
     VALUES ($1, $2, 'Voucher Warn Test', $3, 'Australia/Sydney')`,
    [userId, region, dateOfBirth],
  );
}

async function seedVoucher(
  ownerId: string,
  days: number,
  overrides: { state?: string; remaining?: number; voidReason?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO platform.voucher_fake_voucher
       (id, listing_id, saga_id, owner_id, code, code_hash, state, remaining_value_minor,
        expires_at, void_reason)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, now() + make_interval(secs => $8), $9)`,
    [
      id,
      listing.id,
      `saga_${id}`,
      ownerId,
      `code_${id}`,
      overrides.state ?? "activated",
      overrides.remaining ?? 1000,
      days * 86_400,
      overrides.voidReason ?? null,
    ],
  );
  return id;
}

async function notesFor(userId: string) {
  const { rows } = await pool.query<{
    category: string;
    title: string;
    body: string;
    region: string;
    metadata: { voucherId: string; rewardTitle: string; expiresAt: string };
  }>(`SELECT category, title, body, region, metadata FROM me.notification WHERE user_id = $1`, [
    userId,
  ]);
  return rows;
}

describe("voucher-expiring-warn job", () => {
  it("warns an owner once, in app and by push, about a voucher ending within 7 days", async () => {
    const userId = randomUUID();
    await seedProfile(userId, "1990-01-01");
    const voucherId = await seedVoucher(userId, 3);

    expect(await warnExpiringVouchers(pool, "fake")).toBeGreaterThanOrEqual(1);

    const notes = await notesFor(userId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ category: "voucher_expiring", region: "AU" });
    expect(notes[0]?.body).toContain(listing.title);
    expect(notes[0]?.body).toMatch(/ends on \d{4}-\d{2}-\d{2}\.$/);
    expect(notes[0]?.metadata).toMatchObject({ voucherId, rewardTitle: listing.title });
    expect(new Date(notes[0]?.metadata.expiresAt ?? "").getTime()).toBeGreaterThan(Date.now());
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: userId, idempotencyKey: `voucher_expiring_${voucherId}` }),
    );

    // Never repeated, on a re-run or a day later.
    sendMock.mockClear();
    await warnExpiringVouchers(pool, "fake");
    await job.handle({ id: randomUUID(), name: "voucher.expiring_warn", data: {} } as never, {
      boss: undefined as never,
      config: { databaseUrl: DATABASE_URL, ledger: { mode: "fake" } } as never,
    });
    expect(await notesFor(userId)).toHaveLength(1);
    expect(sendMock).not.toHaveBeenCalledWith(expect.objectContaining({ to: userId }));
  });

  it("leaves out vouchers that are far off, past, used up, voided or not yet active", async () => {
    const userId = randomUUID();
    await seedProfile(userId, "1990-01-01");
    await seedVoucher(userId, 10);
    await seedVoucher(userId, -1);
    await seedVoucher(userId, 2, { remaining: 0 });
    await seedVoucher(userId, 2, { voidReason: "transfer" });
    await seedVoucher(userId, 2, { state: "reserved" });

    await warnExpiringVouchers(pool, "fake");

    expect(await notesFor(userId)).toHaveLength(0);
  });

  it("gives a teen the in-app warning but no push by default, and no one else anything", async () => {
    const teen = randomUUID();
    const stranger = randomUUID();
    await seedProfile(teen, "2012-01-01");
    await seedProfile(stranger, "1990-01-01");
    await seedVoucher(teen, 5);

    await warnExpiringVouchers(pool, "fake");

    expect(await notesFor(teen)).toHaveLength(1);
    expect(await notesFor(stranger)).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalledWith(expect.objectContaining({ to: teen }));
  });

  it("skips the push, not the warning, when the owner opted out", async () => {
    const userId = randomUUID();
    await seedProfile(userId, "1990-01-01");
    await pool.query(
      `INSERT INTO me.notification_preference (user_id, category, push_enabled)
       VALUES ($1, 'voucher_expiring', false)`,
      [userId],
    );
    await seedVoucher(userId, 1);

    await warnExpiringVouchers(pool, "fake");

    expect(await notesFor(userId)).toHaveLength(1);
    expect(sendMock).not.toHaveBeenCalledWith(expect.objectContaining({ to: userId }));
  });

  it("warns nobody whose account no longer exists", async () => {
    const gone = randomUUID();
    await seedVoucher(gone, 2);

    await warnExpiringVouchers(pool, "fake");

    expect(await notesFor(gone)).toHaveLength(0);
  });
});
