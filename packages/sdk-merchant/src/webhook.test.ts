import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifySimulatedWebhookDelivery,
  verifyWebhookSignature,
  WebhookSignatureError,
} from "./webhook";

/**
 * A verbatim copy of `apps/worker/src/jobs/webhook-delivery.ts`'s own
 * `signPayload` — this session's area boundary excludes `apps/worker`, so
 * this cannot import that file directly; it is transcribed here instead,
 * as the spec this SDK verifies against. A drift between the two is
 * exactly the bug this test exists to catch on the SDK's side — if
 * `signPayload` ever changes, this copy (and `verifyWebhookSignature`'s own
 * canonical string) must change with it.
 */
function referenceSignPayload(secret: string, rawBody: string, at: Date): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  const mac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

const SECRET = "a business's webhook signing secret, shown once at registration";

describe("verifyWebhookSignature", () => {
  it("accepts a header produced by the worker's own signing algorithm (cross-check)", () => {
    const rawBody = JSON.stringify({
      event: "voucher.captured",
      data: { voucherId: "v_123", amountMinor: 2500, currency: "AUD" },
    });
    const at = new Date("2026-09-28T09:00:00.000Z");
    const header = referenceSignPayload(SECRET, rawBody, at);

    expect(() =>
      verifyWebhookSignature({ rawBody, signatureHeader: header, secret: SECRET, now: at }),
    ).not.toThrow();
  });

  it("rejects a header signed with a different secret", () => {
    const rawBody = JSON.stringify({ event: "voucher.captured", data: {} });
    const at = new Date("2026-09-28T09:00:00.000Z");
    const header = referenceSignPayload("the wrong secret", rawBody, at);

    expect(() =>
      verifyWebhookSignature({ rawBody, signatureHeader: header, secret: SECRET, now: at }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a header whose body has been tampered with after signing", () => {
    const signedBody = JSON.stringify({ event: "voucher.captured", data: { amountMinor: 2500 } });
    const at = new Date("2026-09-28T09:00:00.000Z");
    const header = referenceSignPayload(SECRET, signedBody, at);
    const tamperedBody = JSON.stringify({
      event: "voucher.captured",
      data: { amountMinor: 999999 },
    });

    expect(() =>
      verifyWebhookSignature({
        rawBody: tamperedBody,
        signatureHeader: header,
        secret: SECRET,
        now: at,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a malformed header", () => {
    expect(() =>
      verifyWebhookSignature({
        rawBody: "{}",
        signatureHeader: "not-a-real-header",
        secret: SECRET,
      }),
    ).toThrow(/malformed webhook signature header/);
  });

  it("accepts a timestamp within the default 5-minute tolerance", () => {
    const rawBody = "{}";
    const signedAt = new Date("2026-09-28T09:00:00.000Z");
    const checkedAt = new Date("2026-09-28T09:04:00.000Z"); // 240s later
    const header = referenceSignPayload(SECRET, rawBody, signedAt);

    expect(() =>
      verifyWebhookSignature({ rawBody, signatureHeader: header, secret: SECRET, now: checkedAt }),
    ).not.toThrow();
  });

  it("rejects a timestamp outside the tolerance window (stale delivery, or a replayed old header)", () => {
    const rawBody = "{}";
    const signedAt = new Date("2026-09-28T09:00:00.000Z");
    const checkedAt = new Date("2026-09-28T09:10:00.000Z"); // 600s later
    const header = referenceSignPayload(SECRET, rawBody, signedAt);

    expect(() =>
      verifyWebhookSignature({ rawBody, signatureHeader: header, secret: SECRET, now: checkedAt }),
    ).toThrow(/tolerance window/);
  });

  it("honours a caller-supplied tolerance window", () => {
    const rawBody = "{}";
    const signedAt = new Date("2026-09-28T09:00:00.000Z");
    const checkedAt = new Date("2026-09-28T09:04:00.000Z"); // 240s later
    const header = referenceSignPayload(SECRET, rawBody, signedAt);

    expect(() =>
      verifyWebhookSignature({
        rawBody,
        signatureHeader: header,
        secret: SECRET,
        now: checkedAt,
        toleranceSeconds: 60,
      }),
    ).toThrow(/tolerance window/);
  });
});

describe("verifySimulatedWebhookDelivery", () => {
  it("reconstructs the raw body from { event, data } and verifies against a simulated sim_outbox row", () => {
    const at = new Date("2026-09-28T09:00:00.000Z");
    const event = "voucher.refunded";
    const data = { voucherId: "v_456", amountMinor: 1000, currency: "AUD" };
    const rawBody = JSON.stringify({ event, data });
    const signatureHeader = referenceSignPayload(SECRET, rawBody, at);

    expect(() =>
      verifySimulatedWebhookDelivery({ event, data, signatureHeader }, SECRET, { now: at }),
    ).not.toThrow();
  });

  it("rejects a delivery whose data was edited after signing", () => {
    const at = new Date("2026-09-28T09:00:00.000Z");
    const event = "voucher.expired";
    const signedData = { voucherId: "v_789" };
    const rawBody = JSON.stringify({ event, data: signedData });
    const signatureHeader = referenceSignPayload(SECRET, rawBody, at);

    expect(() =>
      verifySimulatedWebhookDelivery(
        { event, data: { voucherId: "v_000" }, signatureHeader },
        SECRET,
        { now: at },
      ),
    ).toThrow(WebhookSignatureError);
  });
});
