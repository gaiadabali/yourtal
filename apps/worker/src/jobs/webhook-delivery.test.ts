import { createCipheriv, createHash, randomUUID, randomBytes } from "node:crypto";
import { Pool } from "pg";
import type { Job } from "pg-boss";
import { afterAll, describe, expect, it } from "vitest";
import type { WebhookDeliveryEvent } from "@yourtal/contracts/device/webhook-delivery-event";
import { loadWorkerConfig } from "../config";
import { job } from "./webhook-delivery";

/** Real Postgres, the job's `handle()` called directly — same shape as `campaign-published-notify.test.ts`. */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const ENCRYPTION_KEY = "test-only-webhook-secret-encryption-key-not-a-real-secret-32b";
const config = loadWorkerConfig({
  DATABASE_URL: DATABASE_URL,
  WEBHOOK_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
});
const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

function fakeJob(data: WebhookDeliveryEvent): Job<WebhookDeliveryEvent> {
  return { id: randomUUID(), name: "webhook.delivery", data } as Job<WebhookDeliveryEvent>;
}

/**
 * Seals a secret the same way apps/api's own `sealWebhookSecret` does — a
 * minimal, direct AES-256-GCM call rather than a shared import (cross-app;
 * see the job's own comment on why the two sides each carry their own copy).
 */
function seal(secret: string, key: string): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(key, "utf8").digest(),
    nonce,
  );
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, nonce };
}

async function seedBusinessWithWebhook(url: string, secret: string): Promise<string> {
  const businessId = randomUUID();
  await pool.query(
    `INSERT INTO business.business_accounts
       (id, legal_name, display_name, tax_id_kind, tax_id_value, address_state, address_postcode,
        roles, region, currency, handle)
     VALUES ($1, 'Webhook Test Pty Ltd', 'Webhook Test', 'ABN', '12345678901', 'NSW', '2000',
             '["redeemer"]', 'AU', 'AUD', $2)`,
    [businessId, `biz-webhook-${businessId.slice(0, 8)}`],
  );
  const sealed = seal(secret, ENCRYPTION_KEY);
  await pool.query(
    `INSERT INTO business.webhook_subscription (business_id, url, secret_ciphertext, secret_nonce)
     VALUES ($1, $2, $3, $4)`,
    [businessId, url, sealed.ciphertext, sealed.nonce],
  );
  return businessId;
}

describe("webhook-delivery job", () => {
  it("does nothing when the business has no registered webhook", async () => {
    await expect(
      job.handle(
        fakeJob({
          businessId: randomUUID(),
          eventType: "voucher.captured",
          payload: { captureId: "cap_1" },
          idempotencyKey: "cap_1",
        }),
        { boss: undefined as never, config },
      ),
    ).resolves.toBeUndefined();
  });

  it("signs and delivers to a registered webhook, recoverably from the sealed secret", async () => {
    const secret = "test-webhook-secret-shared-with-the-business";
    const businessId = await seedBusinessWithWebhook("https://example.com/hooks/yourtal", secret);
    const captureId = `cap_${randomUUID()}`;

    await job.handle(
      fakeJob({
        businessId,
        eventType: "voucher.captured",
        payload: { captureId, amountMinor: 1000, currency: "AUD" },
        idempotencyKey: captureId,
      }),
      { boss: undefined as never, config },
    );

    const recorded = await pool.query<{
      recipient: string;
      category: string;
      metadata: { event: string; data: unknown; signatureHeader: string };
    }>(
      `SELECT recipient, category, metadata FROM platform.sim_outbox WHERE boundary = 'webhook' AND idempotency_key = $1`,
      [captureId],
    );
    expect(recorded.rows).toHaveLength(1);
    const row = recorded.rows[0]!;
    expect(row.recipient).toBe("https://example.com/hooks/yourtal");
    expect(row.category).toBe("voucher.captured");
    expect(row.metadata.data).toMatchObject({ captureId, amountMinor: 1000, currency: "AUD" });

    // The header shape the SDK's/a business's own server verifies against (webhookSignatureHeaderSchema).
    expect(row.metadata.signatureHeader).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/u);
  });

  it("is idempotent per capture: a re-delivered event does not duplicate the recorded send", async () => {
    const secret = "another-test-webhook-secret";
    const businessId = await seedBusinessWithWebhook("https://example.com/hooks/second", secret);
    const captureId = `cap_${randomUUID()}`;
    const event: WebhookDeliveryEvent = {
      businessId,
      eventType: "voucher.refunded",
      payload: { captureId },
      idempotencyKey: captureId,
    };

    await job.handle(fakeJob(event), { boss: undefined as never, config });
    await job.handle(fakeJob(event), { boss: undefined as never, config });

    const recorded = await pool.query(
      `SELECT id FROM platform.sim_outbox WHERE boundary = 'webhook' AND idempotency_key = $1`,
      [captureId],
    );
    expect(recorded.rows).toHaveLength(1);
  });
});
