import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpambankConfig } from "../../../config/spambank-config";
import { deleteMailboxes, insertMailbox, testPool } from "../ingest/test-support";
import type { SpambankDb } from "../spambank-db";
import type { SpambankJobQueue } from "./job-queue";
import { StalwartWebhookService } from "./stalwart-webhook.service";

/** The webhook's mailbox lookup against real Postgres, with a recording queue. */

let pool: Pool;
const made: string[] = [];

beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await deleteMailboxes(pool, made);
  await pool.end();
});

function queue(fail = false) {
  const calls: string[] = [];
  const queued: SpambankJobQueue = {
    ingest: (id) => {
      if (fail) return Promise.reject(new Error("queue down"));
      calls.push(`ingest:${id}`);
      return Promise.resolve();
    },
    reconcile: () => {
      if (fail) return Promise.reject(new Error("queue down"));
      calls.push("reconcile");
      return Promise.resolve();
    },
    replyInbox: () => {
      if (fail) return Promise.reject(new Error("queue down"));
      calls.push("reply");
      return Promise.resolve();
    },
  };
  return { calls, queued };
}

function service(queued: SpambankJobQueue): StalwartWebhookService {
  return new StalwartWebhookService({ pool } as unknown as SpambankDb, queued, {
    replyDomain: "spambank.yourtal.gaiada.com",
  } as SpambankConfig);
}

const event = (data: Record<string, unknown>, type = "message-ingest.ham") => ({
  events: [{ type, data }],
});

describe("StalwartWebhookService", () => {
  it("maps a recipient address to its active mailbox and queues one read", async () => {
    const box = await insertMailbox(pool);
    made.push(box.id);
    const { calls, queued } = queue();
    await service(queued).handle(event({ to: [`Someone <${box.address.toUpperCase()}>`] }));
    expect(calls).toEqual([`ingest:${box.id}`]);
  });

  it("maps the Stalwart account id too", async () => {
    const box = await insertMailbox(pool);
    made.push(box.id);
    const { calls, queued } = queue();
    await service(queued).handle(event({ accountId: box.stalwart_account_id }));
    expect(calls).toEqual([`ingest:${box.id}`]);
  });

  it("a mailbox that is not active is not read by the webhook, but the reconcile is asked", async () => {
    const box = await insertMailbox(pool, { status: "suspended" });
    made.push(box.id);
    const { calls, queued } = queue();
    await service(queued).handle(event({ to: [box.address] }));
    expect(calls).toEqual(["reconcile"]);
  });

  it("a payload it cannot read queues a reconcile, never an error", async () => {
    const { calls, queued } = queue();
    await expect(service(queued).handle({ surprise: true })).resolves.toMatchObject({
      reconcile: true,
    });
    await expect(service(queued).handle("garbage")).resolves.toBeDefined();
    expect(calls).toEqual(["reconcile"]);
  });

  it("mail for the reply system account goes to its own job", async () => {
    const { calls, queued } = queue();
    await service(queued).handle(event({ to: ["abuse@spambank.yourtal.gaiada.com"] }));
    expect(calls).toEqual(["reply"]);
  });

  it("an event that is not a delivery does nothing", async () => {
    const { calls, queued } = queue();
    await service(queued).handle(event({ to: ["a@b.example"] }, "auth.failed"));
    expect(calls).toEqual([]);
  });

  it("a queue that is down does not fail the webhook: the reconcile reads the mail", async () => {
    const box = await insertMailbox(pool);
    made.push(box.id);
    const { queued } = queue(true);
    await expect(service(queued).handle(event({ to: [box.address] }))).resolves.toBeDefined();
  });
});
