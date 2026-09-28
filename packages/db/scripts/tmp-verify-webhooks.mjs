import pg from "pg";
import { createHmac, timingSafeEqual } from "node:crypto";

const pool = new pg.Pool({
  connectionString: "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s8c",
});

// Mirrors packages/sdk-merchant/src/webhook.ts's verifyWebhookSignature --
// a small, disclosed re-implementation for this verification script (pg is
// not a dependency packages/sdk-merchant carries), same algorithm.
function verify(rawBody, signatureHeader, secret) {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/u.exec(signatureHeader);
  if (!match) throw new Error(`malformed signature header: ${signatureHeader}`);
  const [, tsText, mac] = match;
  const expected = createHmac("sha256", secret).update(`${tsText}.${rawBody}`).digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("signature does not match");
  }
}

async function checkRegion({ region, receiptId, refundSecret }) {
  console.log(`\n--- ${region} ---`);
  const captureRow = await pool.query(`SELECT id FROM voucher.capture WHERE receipt_id = $1`, [receiptId]);
  if (captureRow.rows.length !== 1) throw new Error(`capture lookup for ${receiptId}: ${captureRow.rows.length} rows`);
  const captureId = captureRow.rows[0].id;
  console.log("captureId", captureId);

  const capturedDeliveries = await pool.query(
    `SELECT id FROM platform.sim_outbox WHERE boundary = 'webhook' AND idempotency_key = $1 AND category = 'voucher.captured'`,
    [captureId],
  );
  console.log(`voucher.captured delivered rows: ${capturedDeliveries.rows.length}`);
  if (capturedDeliveries.rows.length !== 1) {
    throw new Error(`expected exactly 1 voucher.captured delivery, got ${capturedDeliveries.rows.length}`);
  }

  const refundDeliveries = await pool.query(
    `SELECT id, body FROM platform.sim_outbox
      WHERE boundary = 'webhook' AND category = 'voucher.refunded' AND metadata->'data'->>'captureId' = $1`,
    [captureId],
  );
  console.log(`voucher.refunded delivered rows: ${refundDeliveries.rows.length}`);
  if (refundDeliveries.rows.length !== 1) {
    throw new Error(`expected exactly 1 voucher.refunded delivery, got ${refundDeliveries.rows.length}`);
  }

  const delivered = JSON.parse(refundDeliveries.rows[0].body);
  const rawBody = JSON.stringify({ event: delivered.event, data: delivered.data });
  verify(rawBody, delivered.signatureHeader, refundSecret);
  console.log(`${region} refund webhook signature verified OK`);
}

await checkRegion({
  region: "AU",
  receiptId: "rcpt_6583a382-f42f-4bca-b42a-793212bbb5c7",
  refundSecret: "qMZXXjTevNtWwTZj3UHddXCVgvVIW2Qvm5Bge5jJcCE",
});
await checkRegion({
  region: "ID",
  receiptId: "rcpt_854a45a8-afb0-4cd8-9b5b-f8d4cf077ae5",
  refundSecret: "JoA6ee7pCqS2PJtUxXT74POiqMZ7ak0EbdELisBUIXE",
});

await pool.end();
console.log("\nALL CHECKS PASSED");
