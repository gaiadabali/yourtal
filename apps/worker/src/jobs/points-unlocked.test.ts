import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PgBoss } from "pg-boss";
import { createQueueClient } from "@yourtal/queue/client";
import { POINTS_UNLOCKED_QUEUE } from "@yourtal/contracts/ledger-internal/releases";
import type { PointsUnlockedEvent, Release } from "@yourtal/contracts/ledger-internal/releases";
import { signServiceRequest } from "@yourtal/contracts/ledger-internal/service-signature";
import { createWorkerLedgerClient } from "../ledger-client";
import { announceUnlockedPoints, unlockJobId } from "./points-unlocked";

const APP_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (APP_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const SECRET = "test-only-ledger-service-secret-32b";

/** A fake ledger: serves releases until they are acknowledged, and checks every signature. */
class FakeLedger {
  readonly pending = new Map<string, Release>();
  acks: string[][] = [];
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
    const body = JSON.parse(raw) as { limit?: number; grantIds?: string[] };
    if (req.url === "/v1/releases/unnotified") {
      return [200, { releases: [...this.pending.values()].slice(0, body.limit ?? 100) }];
    }
    if (this.failNextAck) {
      this.failNextAck = false;
      return [500, { code: "internal_error" }];
    }
    const ids = body.grantIds ?? [];
    this.acks.push(ids);
    for (const id of ids) this.pending.delete(id);
    return [200, { acknowledged: ids.length }];
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

function release(grantId: string, points: number): Release {
  return {
    grantId,
    userId: "7e57da7a-0000-4000-8000-000000000001",
    region: "AU",
    points: points as Release["points"],
    unlockedAt: "2026-09-26T10:00:00.000Z",
  };
}

describe("announceUnlockedPoints", () => {
  it("sends one ledger.points_unlocked per grant, then acknowledges, even across a failed ack", async () => {
    const client = createWorkerLedgerClient({ baseUrl, serviceSecret: SECRET });
    ledger.pending.set("g_one", release("g_one", 40));
    ledger.pending.set("g_two", release("g_two", 60));

    // The first acknowledgement fails after both sends: the tick throws, so
    // pg-boss retries it, and the next tick re-sends the same two.
    ledger.failNextAck = true;
    await expect(announceUnlockedPoints(boss, client)).rejects.toThrow(/answered 500/);
    expect(await announceUnlockedPoints(boss, client)).toBe(2);
    expect(ledger.acks).toEqual([["g_one", "g_two"]]);
    expect(ledger.badSignatures).toBe(0);

    const sent = await boss.fetch<PointsUnlockedEvent>(POINTS_UNLOCKED_QUEUE, { batchSize: 10 });
    expect(sent.map((job) => job.id).sort()).toEqual(
      [unlockJobId("g_one"), unlockJobId("g_two")].sort(),
    );
    expect(sent.find((job) => job.id === unlockJobId("g_two"))?.data).toEqual({
      ...release("g_two", 60),
      idempotencyKey: "points_unlocked_g_two",
    });

    // Nothing left to announce.
    expect(await announceUnlockedPoints(boss, client)).toBe(0);
  });
});
