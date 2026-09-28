import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  unpostedWebhookEventsSchema,
  webhookEventsPostedSchema,
} from "@yourtal/contracts/voucher-internal/webhook-events";
import type {
  UnpostedWebhookEvents,
  WebhookEventsPosted,
} from "@yourtal/contracts/voucher-internal/webhook-events";
import type { WorkerConfig } from "./config";

/**
 * TASKS.md 8.3.e: the one voucher-internal route the worker calls (the
 * webhook outbox drain). Signed exactly the way
 * services/voucher/internal/serviceauth verifies —
 * apps/api/src/shared/voucher-client/http-voucher-client.ts's own canonical
 * string, copied rather than imported across app boundaries: that client's
 * own comment gives the reasoning (the two services are separate Go
 * modules on purpose; this mirrors that separation instead of threading
 * one signer across both apps).
 */
export interface WorkerVoucherClient {
  unpostedWebhookEvents(limit: number): Promise<UnpostedWebhookEvents>;
  webhookEventsPosted(ids: readonly string[]): Promise<WebhookEventsPosted>;
}

export function createWorkerVoucherClient(voucher: WorkerConfig["voucher"]): WorkerVoucherClient {
  function sign(path: string, body: string): string {
    const t = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();
    const digest = createHash("sha256").update(body).digest("base64");
    const mac = createHmac("sha256", voucher.serviceSecret)
      .update([String(t), "worker", nonce, "POST", path, digest].join("\n"))
      .digest("hex");
    return `t=${String(t)},c=worker,n=${nonce},v1=${mac}`;
  }

  async function post(path: string, body: unknown): Promise<unknown> {
    const payload = JSON.stringify(body);
    const response = await fetch(`${voucher.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-yourtal-service-signature": sign(path, payload),
      },
      body: payload,
    });
    if (!response.ok) {
      throw new Error(
        `voucher ${path} answered ${String(response.status)}: ${await response.text()}`,
      );
    }
    return response.json();
  }

  return {
    async unpostedWebhookEvents(limit) {
      return unpostedWebhookEventsSchema.parse(
        await post("/internal/v1/webhook-events/unposted", { limit }),
      );
    },
    async webhookEventsPosted(ids) {
      return webhookEventsPostedSchema.parse(
        await post("/internal/v1/webhook-events/posted", { ids }),
      );
    },
  };
}
