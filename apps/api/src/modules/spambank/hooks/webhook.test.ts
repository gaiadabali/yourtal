import { createHmac } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { SpambankConfig } from "../../../config/spambank-config";
import { StalwartWebhookController } from "./stalwart-webhook.controller";
import { planWebhook } from "./stalwart-webhook.service";
import type { StalwartWebhookService } from "./stalwart-webhook.service";
import { extractWebhookHints } from "./webhook-payload";
import { WEBHOOK_MAX_BYTES, verifyStalwartSignature } from "./webhook-signature";

const SECRET = "w".repeat(40);
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest();

describe("verifyStalwartSignature (U4: hex, base64 and base64url all accepted)", () => {
  const body = JSON.stringify({ events: [] });
  const digest = sign(body);

  it.each([
    ["hex", digest.toString("hex")],
    ["HEX upper", digest.toString("hex").toUpperCase()],
    ["sha256= prefix", `sha256=${digest.toString("hex")}`],
    ["base64", digest.toString("base64")],
    ["base64url", digest.toString("base64url")],
    ["base64 with sha256=", `sha256=${digest.toString("base64")}`],
    ["padded whitespace", ` ${digest.toString("hex")} `],
  ])("accepts %s", (_name, header) => {
    expect(verifyStalwartSignature(SECRET, body, header)).toBe(true);
  });

  it("works on the raw bytes, not a re-serialisation", () => {
    const spaced = '{ "events" : [ ] }';
    expect(verifyStalwartSignature(SECRET, Buffer.from(spaced), sign(spaced).toString("hex"))).toBe(
      true,
    );
    expect(verifyStalwartSignature(SECRET, body, sign(spaced).toString("hex"))).toBe(false);
  });

  it.each([
    ["no header", undefined],
    ["empty", ""],
    ["wrong key", sign(body, "x".repeat(40)).toString("hex")],
    ["wrong body", sign("{}").toString("hex")],
    ["truncated", digest.toString("hex").slice(0, 60)],
    ["garbage", "not a signature"],
    ["a different algorithm's length", "ab".repeat(20)],
  ])("refuses %s", (_name, header) => {
    expect(verifyStalwartSignature(SECRET, body, header)).toBe(false);
  });

  it("refuses everything when the secret is empty", () => {
    expect(
      verifyStalwartSignature("", body, createHmac("sha256", "").update(body).digest("hex")),
    ).toBe(false);
  });
});

describe("extractWebhookHints (never throws, never trusts a shape)", () => {
  it("reads the documented shape: events with a type and data", () => {
    const hints = extractWebhookHints({
      events: [
        {
          id: "1",
          createdAt: "2026-11-28T00:00:00Z",
          type: "message-ingest.ham",
          data: { accountId: "d", to: ["Geewiz Duck <geewizduck@yourtal.gaiada.com>"], size: 10 },
        },
      ],
    });
    expect(hints).toMatchObject({
      relevantEvents: 1,
      ignoredEvents: 0,
      accountIds: ["d"],
      addresses: ["geewizduck@yourtal.gaiada.com"],
    });
  });

  it("finds recipients and accounts under other plausible keys and depths", () => {
    const hints = extractWebhookHints([
      { type: "delivery.delivered", data: { rcptTo: "A@Yourtal.Gaiada.com", account_id: 7 } },
      {
        type: "message-ingest.spam",
        data: { envelope: { recipients: [{ address: "b@yourtal.gaiada.com" }] } },
      },
    ]);
    expect(hints.accountIds).toEqual(["7"]);
    expect([...hints.addresses].sort()).toEqual(["a@yourtal.gaiada.com", "b@yourtal.gaiada.com"]);
  });

  it("does not take the sender for a recipient", () => {
    const hints = extractWebhookHints({
      events: [
        {
          type: "message-ingest.ham",
          data: { from: "spammer@evil.example", to: ["me@yourtal.gaiada.com"] },
        },
      ],
    });
    expect(hints.addresses).toEqual(["me@yourtal.gaiada.com"]);
  });

  it("ignores events that are not deliveries", () => {
    const hints = extractWebhookHints({
      events: [
        { type: "auth.failed", data: { accountId: "x" } },
        { type: "smtp.connection-start", data: { to: ["a@b.example"] } },
      ],
    });
    expect(hints).toMatchObject({
      relevantEvents: 0,
      ignoredEvents: 2,
      accountIds: [],
      addresses: [],
    });
  });

  it.each([
    ["a string", "hello"],
    ["null", null],
    ["a number", 42],
    ["an empty object", {}],
    ["an array of junk", [1, "a", null, [[[[[[]]]]]]]],
    ["deeply nested", JSON.parse(`${'{"a":'.repeat(50)}1${"}".repeat(50)}`)],
  ])("survives %s", (_name, body) => {
    expect(() => extractWebhookHints(body)).not.toThrow();
  });

  it("describes an unknown shape without carrying any value", () => {
    const hints = extractWebhookHints({
      weird: { secretValue: "hunter2@yourtal.gaiada.com", list: [1, 2] },
    });
    expect(hints.shape).toContain("weird");
    expect(hints.shape).not.toContain("hunter2");
    expect(hints.shape).not.toContain("@");
  });
});

describe("planWebhook", () => {
  const hints = (over: Partial<ReturnType<typeof extractWebhookHints>> = {}) => ({
    relevantEvents: 1,
    ignoredEvents: 0,
    accountIds: [],
    addresses: [],
    shape: "{}",
    ...over,
  });

  it("queues one read per mapped mailbox, once", () => {
    expect(
      planWebhook(
        hints({ addresses: ["a@x.test"] }),
        [{ id: "m1" }, { id: "m1" }, { id: "m2" }],
        "spambank.yourtal.gaiada.com",
      ),
    ).toEqual({
      ingest: ["m1", "m2"],
      replyInbox: false,
      reconcile: false,
    });
  });

  it("mail for the reply system account goes to the reply inbox, not to a reconcile", () => {
    for (const local of ["reply", "abuse", "postmaster"]) {
      expect(
        planWebhook(
          hints({ addresses: [`${local}@spambank.yourtal.gaiada.com`] }),
          [],
          "spambank.yourtal.gaiada.com",
        ),
      ).toEqual({ ingest: [], replyInbox: true, reconcile: false });
    }
    // The same local part on another domain is nothing special.
    expect(
      planWebhook(
        hints({ addresses: ["reply@yourtal.gaiada.com"] }),
        [],
        "spambank.yourtal.gaiada.com",
      ).replyInbox,
    ).toBe(false);
  });

  it("a delivery nobody can map (an unknown shape, an unknown recipient) queues a reconcile", () => {
    expect(planWebhook(hints(), [], "spambank.yourtal.gaiada.com").reconcile).toBe(true);
    expect(
      planWebhook(
        hints({ addresses: ["ghost@yourtal.gaiada.com"] }),
        [],
        "spambank.yourtal.gaiada.com",
      ).reconcile,
    ).toBe(true);
  });

  it("a body with nothing relevant queues nothing", () => {
    expect(planWebhook(hints({ relevantEvents: 0 }), [], "spambank.yourtal.gaiada.com")).toEqual({
      ingest: [],
      replyInbox: false,
      reconcile: false,
    });
  });
});

describe("the route", () => {
  function config(over: Partial<SpambankConfig> = {}): SpambankConfig {
    return {
      replyDomain: "spambank.yourtal.gaiada.com",
      webhookSecret: SECRET,
      ...over,
    } as SpambankConfig;
  }

  function setup(over: Partial<SpambankConfig> = {}) {
    const handle = vi.fn(() =>
      Promise.resolve({ ingest: [], replyInbox: false, reconcile: false }),
    );
    const controller = new StalwartWebhookController(config(over), {
      handle,
    } as unknown as StalwartWebhookService);
    return { controller, handle };
  }

  function request(
    body: string,
    signature: string | undefined,
    parsed: unknown = JSON.parse(body),
  ) {
    const req = {
      headers: signature === undefined ? {} : { "x-signature": signature },
      body: parsed,
    };
    Reflect.set(req, "rawBody", Buffer.from(body));
    return req as unknown as FastifyRequest;
  }

  const body = JSON.stringify({
    events: [{ type: "message-ingest.ham", data: { accountId: "d" } }],
  });

  it("a good signature: accepted, and the body is handed on", async () => {
    const { controller, handle } = setup();
    await expect(controller.receive(request(body, sign(body).toString("hex")))).resolves.toEqual({
      accepted: true,
    });
    expect(handle).toHaveBeenCalledOnce();
  });

  it.each([
    ["a bad signature", sign(body, "z".repeat(40)).toString("hex")],
    ["no signature", undefined],
  ])("%s is 401 and the body is never read", async (_name, signature) => {
    const { controller, handle } = setup();
    await expect(controller.receive(request(body, signature))).rejects.toMatchObject({
      status: 401,
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it("with no webhook secret configured, everything is 401", async () => {
    const { controller, handle } = setup({
      webhookSecret: undefined,
    } as unknown as Partial<SpambankConfig>);
    await expect(
      controller.receive(request(body, sign(body).toString("hex"))),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it("a body over 64 KB is refused before anything is read", async () => {
    const { controller, handle } = setup();
    const big = JSON.stringify({ pad: "a".repeat(WEBHOOK_MAX_BYTES) });
    await expect(controller.receive(request(big, sign(big).toString("hex")))).rejects.toMatchObject(
      {
        status: 413,
      },
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it("no raw body at all is 401", async () => {
    const { controller } = setup();
    const req = { headers: { "x-signature": "ab" }, body: {} } as unknown as FastifyRequest;
    await expect(controller.receive(req)).rejects.toMatchObject({ status: 401 });
  });
});
