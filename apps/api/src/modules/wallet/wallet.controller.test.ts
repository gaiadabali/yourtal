import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { walletHistoryPageSchema, walletSummarySchema } from "@yourtal/contracts/wallet/wallet";
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

beforeAll(async () => {
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

  it("refuses an anonymous caller", async () => {
    expect((await get("/api/wallet", {})).statusCode).toBeGreaterThanOrEqual(401);
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
    const qr = await get(`/api/wallet/vouchers/${voucherId}/qr`, { cookie: owner.cookie });
    expect(qr.statusCode).toBe(200);
    expect(qr.json()).toMatchObject({ voucherId, token: expect.any(String) as unknown });

    // Object-level: another viewer cannot learn the voucher exists.
    expect(
      (await get(`/api/wallet/vouchers/${voucherId}`, { cookie: stranger.cookie })).statusCode,
    ).toBe(404);
    expect(
      (await get(`/api/wallet/vouchers/${voucherId}/qr`, { cookie: stranger.cookie })).statusCode,
    ).toBe(404);
    expect(
      (await get("/api/wallet/vouchers/not-a-uuid", { cookie: owner.cookie })).statusCode,
    ).toBe(404);
  });
});
