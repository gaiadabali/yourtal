import { createHash, randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { AppModule } from "../../app.module";
import { GiftNotifier } from "./gift-notifier";

/**
 * 13.20.b over real HTTP, a real PDP and the fake voucher engine's tables:
 * gift, refusals for a teen and another region, accept, one hop. The live
 * engine's own rules are in services/voucher (gift_test.go) and the live
 * round trip in scripts/check-13.20-gift.mjs.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;

let app: NestFastifyApplication;
let pool: pg.Pool;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const ip = (): string => `10.${[...randomBytes(3)].join(".")}`;

interface Person {
  readonly email: string;
  readonly userId: string;
  readonly token: string;
}

async function person(region: "AU" | "ID", opts: { teen?: boolean } = {}): Promise<Person> {
  const email = `gift-${randomUUID()}@example.test`;
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress: ip(),
    headers: { "idempotency-key": randomUUID() },
    payload: {
      email,
      password: `gift-test-${randomUUID()}`,
      region,
      locale: region === "AU" ? "en-AU" : "id-ID",
      displayName: `Giver ${region}`,
      dateOfBirth: "1990-01-01",
      timezone: region === "AU" ? "Australia/Sydney" : "Asia/Jakarta",
    },
  });
  expect(response.statusCode, response.body).toBeLessThan(300);
  const { userId, token } = response.json<{ userId: string; token: string }>();
  await pool.query(`UPDATE identity.credential SET verified_at = now() WHERE user_id = $1`, [
    userId,
  ]);
  if (opts.teen === true) {
    await pool.query(
      `UPDATE identity.user_profile SET date_of_birth = (now() - interval '15 years')::date,
              parent_consent_status = 'granted' WHERE user_id = $1`,
      [userId],
    );
  }
  return { email, userId, token };
}

/** A transferable ID listing and an active fake voucher on it, owned by `ownerId`. */
async function voucherFor(ownerId: string): Promise<string> {
  const listingId = randomUUID();
  await pool.query(
    `INSERT INTO store.listings
       (id, merchant_id, merchant_name, title, description, category, face_value_minor,
        settlement_value_minor, price_in_points, stock_remaining, stock_total, transferable,
        partial_redemption_policy, minimum_spend_minor, expires_at, status, currency, region,
        audience, content_category, image_url, channel, partial_redemption)
     VALUES ($1, $2, 'Gift Merchant', 'Gift Voucher', 'wallet-gift e2e', 'food_beverage', 50000,
             15000, 1000, 10, 10, true, 'single_use_forfeit', NULL, now() + interval '90 days',
             'available', 'IDR', 'ID', 'all_ages', 'food-and-drink',
             'http://127.0.0.1:26900/p.jpg', 'both', 'single_use')`,
    [listingId, randomUUID()],
  );
  const voucherId = randomUUID();
  const code = randomUUID().replace(/-/g, "").slice(0, 16);
  await pool.query(
    `INSERT INTO platform.voucher_fake_voucher
       (id, listing_id, saga_id, owner_id, code, code_hash, state, remaining_value_minor, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'activated', 50000, now() + interval '90 days')`,
    [
      voucherId,
      listingId,
      randomUUID(),
      ownerId,
      code,
      createHash("sha256").update(code).digest("hex"),
    ],
  );
  return voucherId;
}

function post(url: string, who: Person, payload?: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${who.token}`, "idempotency-key": randomUUID() },
    ...(payload === undefined ? {} : { payload }),
  });
}

describe("13.20.b — gift a voucher", () => {
  it("refuses a teen and another region, gifts once, and the recipient cannot pass it on", async () => {
    const [sender, recipient, teen, abroad] = [
      await person("ID"),
      await person("ID"),
      await person("ID", { teen: true }),
      await person("AU"),
    ];
    const voucherId = await voucherFor(sender.userId);
    const giftTo = (email: string) =>
      post(`/api/wallet/vouchers/${voucherId}/gift`, sender, { recipientEmail: email });

    for (const email of [teen.email, abroad.email, "nobody@example.test"]) {
      const refused = await giftTo(email);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({ code: "gift_recipient_ineligible" });
    }
    expect((await giftTo(sender.email)).json()).toMatchObject({ code: "gift_to_self" });

    const sent = await giftTo(recipient.email);
    expect(sent.statusCode, sent.body).toBe(201);
    const gift = sent.json<{ giftId: string; status: string; direction: string }>();
    expect(gift).toMatchObject({ status: "pending", direction: "sent", senderDisplayName: null });

    const { rows: note } = await pool.query<{ title: string; body: string }>(
      `SELECT title, body FROM me.notification WHERE user_id = $1 AND category = 'gift_received'`,
      [recipient.userId],
    );
    expect(note).toHaveLength(1);
    expect(note[0]?.body).toContain("Giver ID");

    const { rows: old } = await pool.query(
      `SELECT void_reason FROM platform.voucher_fake_voucher WHERE id = $1`,
      [voucherId],
    );
    expect(old[0]?.void_reason).toBe("transfer");

    expect((await post(`/api/wallet/gifts/${gift.giftId}/accept`, teen)).statusCode).toBe(403);
    expect((await post(`/api/wallet/gifts/${gift.giftId}/accept`, abroad)).statusCode).toBe(404);

    const accepted = await post(`/api/wallet/gifts/${gift.giftId}/accept`, recipient);
    expect(accepted.statusCode, accepted.body).toBe(200);
    const received = accepted.json<{ voucherId: string; senderDisplayName: string }>();
    expect(received).toMatchObject({
      status: "accepted",
      direction: "received",
      senderDisplayName: "Giver ID",
    });

    const { rows: fresh } = await pool.query(
      `SELECT owner_id, state FROM platform.voucher_fake_voucher WHERE id = $1`,
      [received.voucherId],
    );
    expect(fresh[0]).toEqual({ owner_id: recipient.userId, state: "activated" });

    const wallet = await app.inject({
      method: "GET",
      url: `/api/wallet/vouchers/${received.voucherId}`,
      headers: { authorization: `Bearer ${recipient.token}` },
    });
    expect(wallet.json()).toMatchObject({ status: "active", giftable: false });

    const again = await post(`/api/wallet/vouchers/${received.voucherId}/gift`, recipient, {
      recipientEmail: sender.email,
    });
    expect(again.json()).toMatchObject({ code: "gift_already_gifted" });
  });

  it("tells the sender when an unaccepted gift goes back (13.20.f)", async () => {
    const [sender, recipient] = [await person("ID"), await person("ID")];
    const voucherId = await voucherFor(sender.userId);
    const sent = await post(`/api/wallet/vouchers/${voucherId}/gift`, sender, {
      recipientEmail: recipient.email,
    });
    const { giftId } = sent.json<{ giftId: string }>();
    await pool.query(
      `UPDATE platform.voucher_fake_gift SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [giftId],
    );
    expect(await app.get(GiftNotifier).sweep()).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query<{ category: string }>(
      `SELECT category FROM me.notification WHERE user_id = $1`,
      [sender.userId],
    );
    expect(rows.map((row) => row.category)).toEqual(["gift_returned"]);
  });
});
