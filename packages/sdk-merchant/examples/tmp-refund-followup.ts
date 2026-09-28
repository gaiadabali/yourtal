/** TEMPORARY: continuation of tmp-e2e-driver.ts's AU run, after the
 * discovery that every Studio-issued credential is device-scoped and so
 * cannot void/refund (found live; see this session's report). Rotates the
 * already-nulled-device_id credential for a fresh secret, then refunds the
 * capture that already succeeded. Deleted before commit. */
import { randomUUID } from "node:crypto";
import { createMerchantClient } from "../src/client";

const API = "http://127.0.0.1:26472";
const VOUCHER_BASE = "http://127.0.0.1:26474";

async function api(method: string, path: string, body?: unknown, token?: string): Promise<any> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (method === "POST") headers["idempotency-key"] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main(): Promise<void> {
  const [merchantId, ownerEmail, ownerPassword, credentialId, receiptId, region] = process.argv.slice(2);
  const owner = await api("POST", "/api/auth/login", { email: ownerEmail, password: ownerPassword });
  const rotated = await api(
    "POST",
    `/api/${merchantId}/studio/developers/credentials/${credentialId}/rotate`,
    {},
    owner.token,
  );
  console.log("rotated credential", rotated.credentialId, "deviceId now:", JSON.stringify(rotated.deviceId));

  const webhookUrl = `https://example.test/webhooks/${region}-refund-${Date.now()}`;
  const webhook = await api(
    "POST",
    `/api/${merchantId}/studio/developers/webhooks`,
    { url: webhookUrl },
    owner.token,
  );

  const client = createMerchantClient({
    baseUrl: VOUCHER_BASE,
    keyId: rotated.credentialId,
    secret: Buffer.from(rotated.secret, "hex"),
  });
  const refund = await client.refund({
    receiptId,
    amountMinor: region === "ID" ? 5_000 : 500,
    reason: "e2e partial refund (non-device credential)",
    refundRef: `e2e-refund-${region}-${Date.now()}`,
  });
  console.log("refunded", refund);
  console.log("SUMMARY", JSON.stringify({ region, receiptId, webhookSecret: webhook.secret }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
