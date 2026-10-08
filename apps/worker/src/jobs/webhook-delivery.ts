import { createDecipheriv, createHash, createHmac } from "node:crypto";
import type { Pool } from "pg";
import { createPool } from "../pool";
import type { Job } from "pg-boss";
import { WEBHOOK_DELIVERY_QUEUE } from "@yourtal/contracts/device/webhook-delivery-event";
import type { WebhookDeliveryEvent } from "@yourtal/contracts/device/webhook-delivery-event";
import { createWebhookDriver } from "@yourtal/drivers/webhook";
import { resolveDriverMode } from "@yourtal/drivers/driver-mode";
import type { SimOutboxEntry, SimOutboxRecord, SimOutboxStore } from "@yourtal/drivers/sim-outbox";
import { defineJob } from "../job";
import type { JobContext } from "../job";

/**
 * TASKS.md 8.3.c: signs and "delivers" (simulated — docs/23, red line 11: no
 * outbound HTTP call ever leaves this process) a `voucher.captured`/
 * `refunded`/`expired` event to a business's registered webhook URL.
 * `@yourtal/drivers`'s existing `WebhookDriver` (1.6.c) already dedupes by
 * `(boundary, idempotencyKey)` — see that boundary's own header for why
 * this reuses it rather than a second outbox.
 *
 * Retries and backoff are `defineQueue`'s own defaults (docs/13, the same
 * ones every other job in this directory gets) — nothing here configures
 * them, and a thrown error from `handle` is exactly what pg-boss retries.
 */
let pool: Pool | undefined;
function poolFor(databaseUrl: string): Pool {
  pool ??= createPool(databaseUrl);
  return pool;
}

/**
 * A standalone copy of `apps/api/src/shared/drivers/postgres-sim-outbox-
 * store.ts` — `@yourtal/drivers`'s own in-memory default store is
 * per-process, which would make a delivery attempt invisible the moment
 * this worker restarts (the exact gap that store's own header warns
 * against). apps/worker has no dependency on apps/api's source tree (a
 * separate deployable), so this is a small, disclosed duplication of the
 * same ~20 lines rather than a cross-app import — same reasoning
 * `business/crypto/opaque-token.ts`'s own comment gives elsewhere.
 */
class PostgresSimOutboxStore implements SimOutboxStore {
  constructor(private readonly db: Pool) {}

  async record(entry: SimOutboxEntry): Promise<SimOutboxRecord> {
    const result = await this.db.query<{
      id: string;
      boundary: string;
      region: string;
      recipient: string;
      category: string;
      subject: string | null;
      body: string;
      metadata: Record<string, unknown>;
      idempotency_key: string;
      created_at: Date;
    }>(
      `INSERT INTO platform.sim_outbox
         (boundary, region, recipient, category, subject, body, metadata, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (boundary, idempotency_key) DO UPDATE SET boundary = EXCLUDED.boundary
       RETURNING id, boundary, region, recipient, category, subject, body, metadata,
                 idempotency_key, created_at`,
      [
        entry.boundary,
        entry.region,
        entry.recipient,
        entry.category,
        entry.subject ?? null,
        entry.body,
        entry.metadata ?? {},
        entry.idempotencyKey,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("platform.sim_outbox insert returned no row");
    return {
      id: row.id,
      boundary: row.boundary as SimOutboxEntry["boundary"],
      region: row.region as SimOutboxEntry["region"],
      recipient: row.recipient,
      category: row.category,
      ...(row.subject === null ? {} : { subject: row.subject }),
      body: row.body,
      metadata: row.metadata,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
    };
  }
}

/**
 * A standalone copy of `apps/api/src/modules/devices/developers/crypto/
 * webhook-secret.ts`'s `openWebhookSecret` — same duplication reasoning as
 * `PostgresSimOutboxStore` above: this job needs to recover the SAME secret
 * apps/api sealed (both read `WEBHOOK_SECRET_ENCRYPTION_KEY`).
 */
const ALGORITHM = "aes-256-gcm";

function keyBytes(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest();
}

function openWebhookSecret(ciphertext: Buffer, nonce: Buffer, key: string): string {
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv(ALGORITHM, keyBytes(key), nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** The header spec `packages/sdk-merchant`/a business's own server verifies against (webhookSignatureHeaderSchema). */
function signPayload(secret: string, rawBody: string, at: Date): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  const mac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

interface SubscriptionRow {
  readonly url: string;
  readonly secret_ciphertext: Buffer;
  readonly secret_nonce: Buffer;
  readonly region: "AU" | "ID";
}

export const job = defineJob<WebhookDeliveryEvent>({
  queue: WEBHOOK_DELIVERY_QUEUE,
  async handle(jobRecord: Job<WebhookDeliveryEvent>, { config }: JobContext) {
    const event = jobRecord.data;
    const client = poolFor(config.databaseUrl);

    const { rows } = await client.query<SubscriptionRow>(
      `SELECT s.url, s.secret_ciphertext, s.secret_nonce, b.region
         FROM business.webhook_subscription s
         JOIN business.business_accounts b ON b.id = s.business_id
        WHERE s.business_id = $1`,
      [event.businessId],
    );
    const subscription = rows[0];
    // No webhook registered for this business — nothing to deliver, and not
    // a failure: most businesses never register one at all.
    if (subscription === undefined) return;

    const secret = openWebhookSecret(
      subscription.secret_ciphertext,
      subscription.secret_nonce,
      config.webhookSecretEncryptionKey,
    );
    const body = JSON.stringify({ event: event.eventType, data: event.payload });
    const signatureHeader = signPayload(secret, body, new Date());

    const mode = resolveDriverMode("webhook", process.env);
    const webhook = createWebhookDriver(
      mode.isOk() ? mode.value : "simulated",
      process.env,
      undefined,
      new PostgresSimOutboxStore(client),
    );

    const sent = await webhook.send({
      idempotencyKey: event.idempotencyKey,
      url: subscription.url,
      region: subscription.region,
      event: event.eventType,
      payload: { event: event.eventType, data: event.payload, signatureHeader },
    });
    if (sent.isErr()) {
      // A thrown error is what pg-boss's own retry/backoff (defineQueue's
      // defaults) acts on — never swallowed here.
      throw new Error(
        `webhook delivery to business ${event.businessId} failed: ${sent.error.kind}`,
      );
    }
  },
});
