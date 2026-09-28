import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PgBoss } from "pg-boss";
import { createQueueClient } from "@yourtal/queue/client";
import { WEBHOOK_DELIVERY_QUEUE } from "@yourtal/contracts/device/webhook-delivery-event";
import type { WebhookDeliveryEvent } from "@yourtal/contracts/device/webhook-delivery-event";
import { createWorkerVoucherClient } from "../voucher-client";
import { drainWebhookOutbox } from "./webhook-outbox-drain";

const APP_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (APP_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const SECRET = "test-only-voucher-service-secret-32b";

/** The exact canonical string services/voucher/internal/serviceauth verifies (webhook-routes.go's own caller). */
function sign(path: string, body: string, at: number, nonce: string): string {
  const digest = createHash("sha256").update(body).digest("base64");
  const mac = createHmac("sha256", SECRET)
    .update([String(at), "worker", nonce, "POST", path, digest].join("\n"))
    .digest("hex");
  return `t=${String(at)},c=worker,n=${nonce},v1=${mac}`;
}

interface OutboxRow {
  id: string;
  eventType: string;
  merchantId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** A fake voucher service: serves unposted rows until acknowledged, and checks every signature. */
class FakeVoucher {
  readonly pending = new Map<string, OutboxRow>();
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
    const expected = sign(req.url ?? "", raw, Number(fields["t"]), String(fields["n"]));
    if (header !== expected) {
      this.badSignatures++;
      return [401, {}];
    }
    const body = JSON.parse(raw) as { limit?: number; ids?: string[] };
    if (req.url === "/internal/v1/webhook-events/unposted") {
      return [200, { events: [...this.pending.values()].slice(0, body.limit ?? 100) }];
    }
    if (this.failNextAck) {
      this.failNextAck = false;
      return [500, { code: "internal_error" }];
    }
    const ids = body.ids ?? [];
    this.acks.push(ids);
    for (const id of ids) this.pending.delete(id);
    return [200, { acknowledged: ids.length }];
  }
}

let boss: PgBoss;
let voucher: FakeVoucher;
let baseUrl: string;

beforeAll(async () => {
  boss = createQueueClient({ databaseUrl: APP_URL });
  await boss.start();
  voucher = new FakeVoucher();
  await new Promise<void>((resolve) => voucher.server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${String((voucher.server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await boss.stop({ close: true, graceful: false });
  await new Promise((resolve) => voucher.server.close(resolve));
});

/** id must be a real uuid (the contract's own shape); label is what the assertions read. */
function outboxRow(id: string, label: string, eventType: string): OutboxRow {
  return {
    id,
    eventType,
    merchantId: "7e57da7a-0000-4000-8000-000000000001",
    idempotencyKey: `${eventType}_${label}`,
    payload: { captureId: label, amountMinor: 1_000, currency: "AUD" },
    createdAt: "2026-09-28T10:00:00.000Z",
  };
}

const EVT_ONE = "7e57da7a-0000-4000-8000-0000000000a1";
const EVT_TWO = "7e57da7a-0000-4000-8000-0000000000a2";
const EVT_THREE = "7e57da7a-0000-4000-8000-0000000000a3";

describe("drainWebhookOutbox", () => {
  it("sends one webhook.delivery job per outbox row, then acknowledges", async () => {
    const client = createWorkerVoucherClient({ baseUrl, serviceSecret: SECRET });
    voucher.pending.set(EVT_ONE, outboxRow(EVT_ONE, "evt_one", "voucher.captured"));
    voucher.pending.set(EVT_TWO, outboxRow(EVT_TWO, "evt_two", "voucher.refunded"));

    expect(await drainWebhookOutbox(boss, client)).toBe(2);
    expect(voucher.acks).toEqual([[EVT_ONE, EVT_TWO]]);
    expect(voucher.badSignatures).toBe(0);

    const sent = await boss.fetch<WebhookDeliveryEvent>(WEBHOOK_DELIVERY_QUEUE, { batchSize: 10 });
    expect(sent.map((job) => job.data.idempotencyKey).sort()).toEqual([
      "voucher.captured_evt_one",
      "voucher.refunded_evt_two",
    ]);
    const captured = sent.find((job) => job.data.idempotencyKey === "voucher.captured_evt_one");
    expect(captured?.data).toEqual({
      businessId: "7e57da7a-0000-4000-8000-000000000001",
      eventType: "voucher.captured",
      payload: { captureId: "evt_one", amountMinor: 1_000, currency: "AUD" },
      idempotencyKey: "voucher.captured_evt_one",
    });

    // Nothing left to drain.
    expect(await drainWebhookOutbox(boss, client)).toBe(0);
  });

  it("resends the same idempotency key when the acknowledgement fails, relying on the delivery job's own dedup", async () => {
    const client = createWorkerVoucherClient({ baseUrl, serviceSecret: SECRET });
    voucher.pending.set(EVT_THREE, outboxRow(EVT_THREE, "evt_three", "voucher.captured"));

    // The send reaches pg-boss before the ack does; the ack failing throws,
    // so pg-boss retries the TICK, not just the ack — this job has no
    // stable pg-boss job id (unlike points-unlocked.ts's unlockJobId), so
    // the retry re-sends the same row rather than being deduped here. That
    // is deliberate: webhook-delivery.ts's own dedup
    // (platform.sim_outbox's (boundary, idempotency_key) uniqueness) is
    // what makes this safe, not this layer.
    voucher.failNextAck = true;
    await expect(drainWebhookOutbox(boss, client)).rejects.toThrow(/answered 500/);
    expect(await drainWebhookOutbox(boss, client)).toBe(1);

    const sent = await boss.fetch<WebhookDeliveryEvent>(WEBHOOK_DELIVERY_QUEUE, { batchSize: 10 });
    const keys = sent.map((job) => job.data.idempotencyKey);
    expect(keys.filter((key) => key === "voucher.captured_evt_three")).toHaveLength(2);

    // Acknowledged for good; nothing left to drain.
    expect(await drainWebhookOutbox(boss, client)).toBe(0);
  });
});
