import { createHmac } from "node:crypto";
import type { PaySimConfig } from "./config";
import { unix } from "./ctx";
import type { ClaimedDelivery, DeliveryResult, PaySimStore } from "./store";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Delay after the 1st, 2nd, ... failed attempt; then every 12 h. */
export const RETRY_DELAYS_MS = [10 * SECOND, MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 6 * HOUR];
export const REPEAT_DELAY_MS = 12 * HOUR;
/** A delivery still failing this long after its event is given up on. */
export const GIVE_UP_AFTER_MS = 72 * HOUR;
export const ATTEMPT_TIMEOUT_MS = 10 * SECOND;
/** A claimed delivery is invisible to other workers for this long. */
export const LEASE_MS = 60 * SECOND;

/** Stripe's scheme: `t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. */
export function signPayload(secret: string, timestamp: number, body: string): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/** When to try again after `failures` failed attempts, or null to give up. */
export function nextAttemptAt(failures: number, eventCreatedAt: Date, now: Date): Date | null {
  const delay = RETRY_DELAYS_MS[failures - 1] ?? REPEAT_DELAY_MS;
  const next = new Date(now.getTime() + delay);
  return next.getTime() > eventCreatedAt.getTime() + GIVE_UP_AFTER_MS ? null : next;
}

async function attempt(
  d: ClaimedDelivery,
  config: PaySimConfig,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<DeliveryResult> {
  const attempts = d.attempts + 1;
  const body = JSON.stringify(d.event);
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetchImpl(config.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "stripe-signature": signPayload(config.webhookSecret, unix(now()), body),
        "user-agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
    statusCode = res.status;
    await res.body?.cancel().catch(() => undefined);
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.name : "error";
  }
  if (error === null) {
    return {
      attempts,
      status: "delivered",
      nextAttemptAt: now(),
      lastStatusCode: statusCode,
      lastError: null,
    };
  }
  const next = nextAttemptAt(attempts, d.eventCreatedAt, now());
  return {
    attempts,
    status: next === null ? "failed" : "pending",
    nextAttemptAt: next ?? now(),
    lastStatusCode: statusCode,
    lastError: error,
  };
}

/** Sends every delivery that is due. Returns how many were attempted. */
export async function deliverDue(opts: {
  store: PaySimStore;
  config: PaySimConfig;
  fetch: typeof fetch;
  now: () => Date;
}): Promise<number> {
  const claimed = await opts.store.claimDeliveries(opts.now(), 25, LEASE_MS);
  await Promise.all(
    claimed.map(async (d) => {
      const result = await attempt(d, opts.config, opts.fetch, opts.now);
      await opts.store.recordDelivery(d.id, result, opts.now());
    }),
  );
  return claimed.length;
}
