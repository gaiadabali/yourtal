import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PgBoss } from "pg-boss";
import { createQueueClient } from "@yourtal/queue/client";
import { POINTS_EXPIRING_QUEUE } from "@yourtal/contracts/ledger-internal/expiry";
import type { ExpiryNotice, PointsExpiringEvent } from "@yourtal/contracts/ledger-internal/expiry";
import { signServiceRequest } from "@yourtal/contracts/ledger-internal/service-signature";
import { createWorkerLedgerClient } from "../ledger-client";
import { announceExpiringPoints, expiringJobId } from "./points-expiring-announce";

const APP_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (APP_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const SECRET = "test-only-ledger-service-secret-32b";

/** A fake ledger: serves notices until they are acknowledged, and checks every signature. */
class FakeLedger {
  readonly pending = new Map<string, ExpiryNotice>();
  acks: unknown[][] = [];
  failNextAck = false;
  badSignatures = 0;
  server: Server = createServer((req, res) => {
    void this.answer(req).then(([status, body]) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });

  private async answer(req: IncomingMessage): Promise<[number, unknown]> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const header = String(req.headers["x-yourtal-service-signature"] ?? "");
    const fields = Object.fromEntries(header.split(",").map((part) => part.split("=")));
    const expected = signServiceRequest({
      secret: SECRET,
      caller: "worker",
      method: req.method ?? "",
      pathAndQuery: req.url ?? "",
      body: raw,
      unixSeconds: Number(fields["t"]),
      nonce: String(fields["n"]),
    });
    if (header !== expected) {
      this.badSignatures++;
      return [401, {}];
    }
    const body = JSON.parse(raw) as { limit?: number; notices?: unknown[] };
    if (req.url === "/v1/economy/expiry/unnotified") {
      return [200, { notices: [...this.pending.values()].slice(0, body.limit ?? 100) }];
    }
    if (this.failNextAck) {
      this.failNextAck = false;
      return [500, { code: "internal_error" }];
    }
    const notices = body.notices ?? [];
    this.acks.push(notices);
    for (const notice of notices) {
      const key = (notice as { accountId: string }).accountId;
      this.pending.delete(key);
    }
    return [200, { acknowledged: notices.length }];
  }
}

let boss: PgBoss;
let ledger: FakeLedger;
let baseUrl: string;

beforeAll(async () => {
  boss = createQueueClient({ databaseUrl: APP_URL });
  await boss.start();
  ledger = new FakeLedger();
  await new Promise<void>((resolve) => ledger.server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${String((ledger.server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await boss.stop({ close: true, graceful: false });
  await new Promise((resolve) => ledger.server.close(resolve));
});

function notice(accountId: string, milestoneDays: 30 | 7, points: number): ExpiryNotice {
  return {
    accountId,
    userId: "7e57da7a-0000-4000-8000-000000000001",
    region: "AU",
    milestoneDays,
    expiringAt: "2026-11-01T00:00:00.000Z",
    points: points as ExpiryNotice["points"],
  };
}

describe("announceExpiringPoints", () => {
  it("sends one ledger.points_expiring per notice, then acknowledges, even across a failed ack", async () => {
    const client = createWorkerLedgerClient({ baseUrl, serviceSecret: SECRET });
    ledger.pending.set("acc_one", notice("acc_one", 30, 40));
    ledger.pending.set("acc_two", notice("acc_two", 7, 60));

    // The first acknowledgement fails after both sends: the tick throws, so
    // pg-boss retries it, and the next tick re-sends the same two.
    ledger.failNextAck = true;
    await expect(announceExpiringPoints(boss, client)).rejects.toThrow(/answered 500/);
    expect(await announceExpiringPoints(boss, client)).toBe(2);
    expect(ledger.acks).toEqual([
      [
        { accountId: "acc_one", milestoneDays: 30, expiringAt: "2026-11-01T00:00:00.000Z" },
        { accountId: "acc_two", milestoneDays: 7, expiringAt: "2026-11-01T00:00:00.000Z" },
      ],
    ]);
    expect(ledger.badSignatures).toBe(0);

    const sent = await boss.fetch<PointsExpiringEvent>(POINTS_EXPIRING_QUEUE, { batchSize: 10 });
    expect(sent.map((job) => job.id).sort()).toEqual(
      [
        expiringJobId("acc_one", 30, "2026-11-01T00:00:00.000Z"),
        expiringJobId("acc_two", 7, "2026-11-01T00:00:00.000Z"),
      ].sort(),
    );
    expect(sent.find((job) => job.data.accountId === "acc_two")?.data).toEqual({
      ...notice("acc_two", 7, 60),
      idempotencyKey: "points_expiring_acc_two_7_2026-11-01T00:00:00.000Z",
    });

    // Nothing left to announce.
    expect(await announceExpiringPoints(boss, client)).toBe(0);
  });
});
