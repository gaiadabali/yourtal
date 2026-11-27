import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { Pool } from "pg";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { snapappReceiver } from "@yourtal/contracts/spambank/events";
import type { MachineClient } from "../../oidc/clients";
import { VERIFIED_OIDC_CLIENT_KEY } from "../../oidc/teen-invite-client.guard";
import type { OidcRuntime } from "../../oidc/oidc-runtime";
import type { SpambankDb } from "../spambank-db";
import { SpambankIngestMachineController } from "./ingest-machine.controller";
import { SpambankMachineService } from "./machine.service";
import type { Account, MailboxFixture } from "./test-support";
import {
  account,
  deleteMailboxes,
  failure,
  fakeDriver,
  insertMailbox,
  linkSnapapp,
  testPool,
} from "./test-support";

/**
 * BUILD.md T6 done-when (4): `/attachments/fetch` returns the bytes (SHA-256 equal to the original) for an
 * offered blob and 404 for any other; `/statements/ack` stores the outcome. Real Postgres, a scripted
 * Stalwart, the controller called as Nest would.
 */

const SECTOR = snapappReceiver("staging")?.sector ?? "snapapp-staging";
const BYTES = Buffer.from("date,description,amount\n2026-11-01,Coffee,-4.50\n");

let pool: Pool;
const made: string[] = [];

beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await deleteMailboxes(pool, made);
  await pool.end();
});

const SNAPAPP: MachineClient = {
  clientId: "snapapp-staging-server",
  name: "SnapApp",
  app: "snapapp",
  operator: "SnapApp",
  externalOperator: false,
  sector: SECTOR,
  kind: "machine",
  auth: "private_key_jwt",
  allowedScopes: ["spambank"],
  environments: ["staging"],
};
const FTR: MachineClient = { ...SNAPAPP, clientId: "ftr-server", app: "ftr", sector: "ftr" };

function controller(script: Account, drive: Partial<{ clients: MachineClient[] }> = {}) {
  const runtime = { clients: drive.clients ?? [SNAPAPP, FTR] } as unknown as OidcRuntime;
  const machine = new SpambankMachineService({ pool } as unknown as SpambankDb, fakeDriver(script));
  return new SpambankIngestMachineController(runtime, machine);
}

function as(client: MachineClient): FastifyRequest {
  const request = {} as FastifyRequest;
  Reflect.set(request, VERIFIED_OIDC_CLIENT_KEY, client.clientId);
  return request;
}

async function person(over: Parameters<typeof insertMailbox>[1] = {}) {
  const box: MailboxFixture = await insertMailbox(pool, over);
  made.push(box.id);
  const sub = await linkSnapapp(pool, box.user_id, SECTOR);
  return { box, sub };
}

async function offer(box: MailboxFixture, emailId = "mail1", blobId = "blob1") {
  await pool.query(
    `INSERT INTO spambank.statement_offer (mailbox_id, email_id, blob_id, name, type, size)
     VALUES ($1, $2, $3, 'statement nov.csv', 'text/csv', $4)`,
    [box.id, emailId, blobId, BYTES.length],
  );
}

const script = () =>
  account({ blobs: { blob1: { type: "application/octet-stream", bytes: new Uint8Array(BYTES) } } });

async function bytesOf(file: { getStream(): Readable }): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

describe("POST /api/oidc-clients/spambank/attachments/fetch", () => {
  it("returns the offered file byte for byte, with the part's type and safe headers", async () => {
    const { box, sub } = await person();
    await offer(box);
    const stalwart = script();
    const file = await controller(stalwart).fetch(
      { sub, emailId: "mail1", blobId: "blob1" },
      as(SNAPAPP),
    );
    const bytes = await bytesOf(file);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      createHash("sha256").update(BYTES).digest("hex"),
    );
    expect(file.options.type).toBe("text/csv");
    expect(file.options.disposition).toBe("attachment; filename*=UTF-8''statement%20nov.csv");
    // It asked Stalwart's own download path, built from the session's template.
    expect(stalwart.paths).toContain(
      "/jmap/download/A1/blob1/statement%20nov.csv?accept=text%2Fcsv",
    );
  });

  it("is 404 for a blob that was never offered, and never asks Stalwart for it", async () => {
    const { box, sub } = await person();
    await offer(box);
    const stalwart = account({
      blobs: { other: { type: "text/csv", bytes: new Uint8Array(BYTES) } },
    });
    await expect(
      controller(stalwart).fetch({ sub, emailId: "mail1", blobId: "other" }, as(SNAPAPP)),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller(stalwart).fetch({ sub, emailId: "mail9", blobId: "blob1" }, as(SNAPAPP)),
    ).rejects.toMatchObject({ status: 404 });
    expect(stalwart.paths).toEqual([]);
  });

  it("never serves one person an offer made to another", async () => {
    const mine = await person();
    const theirs = await person();
    await offer(theirs.box);
    await expect(
      controller(script()).fetch({ sub: mine.sub, emailId: "mail1", blobId: "blob1" }, as(SNAPAPP)),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("is for SnapApp only", async () => {
    const { box, sub } = await person();
    await offer(box);
    await expect(
      controller(script()).fetch({ sub, emailId: "mail1", blobId: "blob1" }, as(FTR)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    ["an unknown sub", 404, () => Promise.resolve("no-such-sub")],
    [
      "a person who ended their access to SnapApp",
      403,
      async () => {
        const box = await insertMailbox(pool);
        made.push(box.id);
        return linkSnapapp(pool, box.user_id, SECTOR, { ended: true });
      },
    ],
    [
      "a person with no mailbox",
      409,
      async () => {
        const userId = `sbt6-nobox-${Date.now()}`;
        const sub = await linkSnapapp(pool, userId, SECTOR);
        return sub;
      },
    ],
  ])("refuses %s", async (_name, status, makeSub) => {
    const sub = await makeSub();
    await expect(
      controller(script()).fetch({ sub, emailId: "mail1", blobId: "blob1" }, as(SNAPAPP)),
    ).rejects.toMatchObject({ status });
  });

  it("refuses a suspended mailbox", async () => {
    const { box, sub } = await person({ status: "suspended" });
    await offer(box);
    await expect(
      controller(script()).fetch({ sub, emailId: "mail1", blobId: "blob1" }, as(SNAPAPP)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("is 503 when Stalwart is down and 404 when it no longer has the blob", async () => {
    const { box, sub } = await person();
    await offer(box);
    await expect(
      controller(account({ down: failure("unavailable") })).fetch(
        { sub, emailId: "mail1", blobId: "blob1" },
        as(SNAPAPP),
      ),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      controller(account({ blobs: {} })).fetch(
        { sub, emailId: "mail1", blobId: "blob1" },
        as(SNAPAPP),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("POST /api/oidc-clients/spambank/statements/ack", () => {
  it("stores the outcome and a detail, and a repeat is the same row", async () => {
    const { box, sub } = await person();
    await offer(box);
    const c = controller(script());
    await c.ack(
      { sub, emailId: "mail1", blobId: "blob1", outcome: "imported", detail: "doc 42" },
      as(SNAPAPP),
    );
    await c.ack(
      { sub, emailId: "mail1", blobId: "blob1", outcome: "imported", detail: "doc 42" },
      as(SNAPAPP),
    );
    const row = await pool.query<{ outcome: string; detail: string; outcome_at: Date }>(
      "SELECT outcome, detail, outcome_at FROM spambank.statement_offer WHERE mailbox_id = $1",
      [box.id],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({ outcome: "imported", detail: "doc 42" });
    expect(row.rows[0]?.outcome_at).toBeInstanceOf(Date);
  });

  it("is 404 for an offer that does not exist for this person, and cannot touch someone else's", async () => {
    const mine = await person();
    const theirs = await person();
    await offer(theirs.box);
    const c = controller(script());
    await expect(
      c.ack({ sub: mine.sub, emailId: "mail1", blobId: "blob1", outcome: "skipped" }, as(SNAPAPP)),
    ).rejects.toMatchObject({ status: 404 });
    const untouched = await pool.query(
      "SELECT outcome FROM spambank.statement_offer WHERE mailbox_id = $1",
      [theirs.box.id],
    );
    expect(untouched.rows).toEqual([{ outcome: null }]);
  });

  it("is for SnapApp only", async () => {
    const { box, sub } = await person();
    await offer(box);
    await expect(
      controller(script()).ack(
        { sub, emailId: "mail1", blobId: "blob1", outcome: "failed" },
        as(FTR),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
