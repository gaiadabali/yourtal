import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import {
  walletHistoryPageSchema,
  walletSummarySchema,
  walletVoucherDetailSchema,
} from "@yourtal/contracts/wallet/wallet";
import { AppModule } from "../../app.module";
import {
  LEDGER_INTERNAL_CLIENT,
  type LedgerInternalClient,
} from "../../shared/ledger-client/ledger-internal-client";
import {
  VOUCHER_INTERNAL_CLIENT,
  type VoucherInternalClient,
} from "../../shared/voucher-client/voucher-internal-client";
import { sessionFor } from "../../shared/testing/session-for";

// 4.8: the wallet over real HTTP, a real PDP and the ledger/voucher clients
// this app is configured with (the fakes in CI).

let app: NestFastifyApplication;
let ledger: LedgerInternalClient;
let vouchers: VoucherInternalClient;
// 12.2.b's teen-cap test registers a 14-year-old -- forced on for this
// suite's OWN moduleRef only, same isolated-container reasoning
// `guardian-consent.e2e.test.ts` documents, restored in `afterAll`.
const originalTeenAccounts = process.env["TEEN_ACCOUNTS"];

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  ledger = app.get(LEDGER_INTERNAL_CLIENT);
  vouchers = app.get(VOUCHER_INTERNAL_CLIENT);
  const funded = await ledger.fundMarketing({
    region: "ID",
    amountMinor: toMinorUnits(50_000_000),
    proposedBy: "staff-1",
    approvedBy: "staff-2",
  });
  expect(funded.isOk()).toBe(true);
});

afterAll(async () => {
  await app.close();
  if (originalTeenAccounts === undefined) {
    delete process.env["TEEN_ACCOUNTS"];
  } else {
    process.env["TEEN_ACCOUNTS"] = originalTeenAccounts;
  }
});

async function get(url: string, headers: Record<string, string>) {
  return app.inject({ method: "GET", url, headers });
}

describe("GET /api/wallet", () => {
  it("shows a held grant as pending with its unlock date, not as spendable", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const granted = await ledger.grantAction({
      kind: "streak",
      userId: session.userId,
      region: "ID",
      points: toPoints(60),
      trustTier: 0,
      idempotencyKey: randomUUID(),
    });
    expect(granted.isOk()).toBe(true);

    const response = await get("/api/wallet", { cookie: session.cookie });
    expect(response.statusCode).toBe(200);
    const wallet = walletSummarySchema.parse(response.json());
    expect(wallet).toMatchObject({ region: "ID", availablePoints: 0, pendingPoints: 60 });
    expect(wallet.pending).toHaveLength(1);
    expect(new Date(wallet.pending[0]?.unlockAt ?? 0).getTime()).toBeGreaterThan(Date.now());

    // B never reaches a client (4.9.d).
    expect(response.body).not.toMatch(/micros|backing|rate/i);
  });

  it("refuses an anonymous caller with 401, not 403 (F30)", async () => {
    const response = await get("/api/wallet", {});
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "no_session" });
  });

  // 12.2.b: the teen daily-cap meter reads this same summary. An adult gets
  // no such field at all -- no adult-facing meter exists to read it.
  it("carries the region's teen daily earn cap for a teen viewer, and omits it for an adult", async () => {
    const fourteenYearsAgo = (() => {
      const now = new Date();
      const dob = new Date(
        Date.UTC(now.getUTCFullYear() - 14, now.getUTCMonth(), now.getUTCDate()),
      );
      return dob.toISOString().slice(0, 10);
    })();

    const teen = await sessionFor(app, {
      jurisdiction: "AU",
      dateOfBirth: fourteenYearsAgo,
      guardianEmail: `guardian+${randomUUID()}@example.test`,
    });
    const teenResponse = await get("/api/wallet", { cookie: teen.cookie });
    expect(teenResponse.statusCode).toBe(200);
    // AU's F12 default (packages/db migration 20260925193000).
    expect(walletSummarySchema.parse(teenResponse.json()).dailyCapPoints).toBe(250);

    const adult = await sessionFor(app, { jurisdiction: "AU", dateOfBirth: "1990-01-01" });
    const adultResponse = await get("/api/wallet", { cookie: adult.cookie });
    expect(adultResponse.statusCode).toBe(200);
    expect(walletSummarySchema.parse(adultResponse.json()).dailyCapPoints).toBeUndefined();
  });
});

describe("GET /api/wallet/history", () => {
  it("lists the grant as an earn entry, with no prose and no ledger reference", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const granted = await ledger.grantAction({
      kind: "goodwill",
      userId: session.userId,
      region: "ID",
      points: toPoints(25),
      trustTier: 3,
      idempotencyKey: randomUUID(),
    });
    expect(granted.isOk()).toBe(true);

    const response = await get("/api/wallet/history", { cookie: session.cookie });
    expect(response.statusCode).toBe(200);
    const page = walletHistoryPageSchema.parse(response.json());
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({ kind: "earn", direction: "credit", points: 25 });
    expect(page.entries[0]?.description).toBeUndefined();
    expect(page.nextCursor).toBeNull();
    expect(response.body).not.toContain("externalRef");
  });
});

describe("GET /api/wallet/vouchers", () => {
  it("shows the caller's own voucher and its QR token, and hides it from anyone else", async () => {
    const owner = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const stranger = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const sagaId = `saga_${randomUUID()}`;
    const reserved = await vouchers.reserve({ listingId: randomUUID(), sagaId });
    expect(reserved.isOk()).toBe(true);
    expect((await vouchers.activate({ sagaId, ownerId: owner.userId })).isOk()).toBe(true);
    const voucherId = reserved._unsafeUnwrap().voucherId;

    const list = await get("/api/wallet/vouchers", { cookie: owner.cookie });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ vouchers: [{ voucherId, state: "activated" }] });
    expect(list.body).not.toContain(sagaId);

    const one = await get(`/api/wallet/vouchers/${voucherId}`, { cookie: owner.cookie });
    expect(one.statusCode).toBe(200);
    // 13.3.o: the owner reads the redemption code on the single read, uncached,
    // and never on the list.
    const code = (await vouchers.reveal({ voucherId, ownerId: owner.userId }))._unsafeUnwrap().code;
    expect(walletVoucherDetailSchema.parse(one.json()).code).toBe(code);
    expect(one.headers["cache-control"]).toBe("no-store");
    expect(list.body).not.toContain(code);
    const qr = await get(`/api/wallet/vouchers/${voucherId}/qr`, { cookie: owner.cookie });
    expect(qr.statusCode).toBe(200);
    expect(qr.json()).toMatchObject({ voucherId, token: expect.any(String) as unknown });

    // Object-level: another viewer cannot learn the voucher exists.
    const hidden = await get(`/api/wallet/vouchers/${voucherId}`, { cookie: stranger.cookie });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(code);
    expect(
      (await get(`/api/wallet/vouchers/${voucherId}/qr`, { cookie: stranger.cookie })).statusCode,
    ).toBe(404);
    expect(
      (await get("/api/wallet/vouchers/not-a-uuid", { cookie: owner.cookie })).statusCode,
    ).toBe(404);
  });
});

describe("GET /api/wallet/vouchers/:voucherId code", () => {
  it("is withheld once the voucher is voided: nothing left to redeem", async () => {
    const owner = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1990-01-01" });
    const sagaId = `saga_${randomUUID()}`;
    const reserved = await vouchers.reserve({ listingId: randomUUID(), sagaId });
    await vouchers.activate({ sagaId, ownerId: owner.userId });
    const voucherId = reserved._unsafeUnwrap().voucherId;
    const voided = await vouchers.voidVoucher({
      voucherId,
      ownerId: owner.userId,
      reason: "dispute",
    });
    expect(voided.isOk()).toBe(true);

    const one = await get(`/api/wallet/vouchers/${voucherId}`, { cookie: owner.cookie });
    expect(one.statusCode).toBe(200);
    expect(one.json()).not.toHaveProperty("code");
  });
});
