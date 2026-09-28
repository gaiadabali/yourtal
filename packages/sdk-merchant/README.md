# @yourtal/sdk-merchant

A small, zero-runtime-dependency TypeScript SDK for the YourTal voucher
service's merchant API: authorize, capture, void and refund a voucher from
your own backend. Every request is HMAC-signed and idempotent, with
built-in retries for transient failures.

This is the same content Studio → Developers shows on its signing/API
documentation page (TASKS.md 8.3.a) — if you're reading this from there,
everything below applies as written.

## Install

Inside the YourTal monorepo, add it as a workspace dependency:

```json
{ "dependencies": { "@yourtal/sdk-merchant": "workspace:*" } }
```

This package ships as TypeScript source with no build step (see its
`exports` map) — your bundler or `tsx`/`ts-node`-style runtime resolves it
directly, the same as any other workspace package.

## Quick start

```ts
import { createMerchantClient } from "@yourtal/sdk-merchant/client";

const client = createMerchantClient({
  baseUrl: "https://voucher.yourtal.example",
  keyId: process.env.MERCHANT_KEY_ID!,
  // Studio issues `secret` as 64 hex characters -- decode to the 32 raw
  // bytes before signing with it (see "Getting credentials" below).
  secret: Buffer.from(process.env.MERCHANT_SECRET!, "hex"),
});

const authorization = await client.authorize({
  code: "ABCD1234EFGH5678K", // scanned or typed at the till
  amountMinor: 3000, // the amount to redeem, in minor units
  currency: "AUD",
  orderTotalMinor: 5000, // the whole basket — checked against minimum-spend vouchers
});

const capture = await client.capture({
  authorizationId: authorization.authorizationId,
  finalAmountMinor: 3000,
});
```

See `examples/authorize-and-capture.ts` for a runnable version
(`pnpm --filter @yourtal/sdk-merchant example:authorize-and-capture`).

### Getting credentials

Studio → Developers (TASKS.md 8.3.a) issues a `keyId`/`secret` pair per
business, plus a separate **sandbox** credential that talks to a simulated
voucher catalogue — use the sandbox pair while you integrate, never a live
one. Credentials can be rotated or revoked from the same page; rotating
issues a new pair without invalidating the old one until you remove it, so
a deploy never has a window with no working key.

`secret` is always 64 hex characters — the wire encoding of the 32 raw
bytes `services/voucher` actually signs with (it cannot return the raw
bytes as JSON text safely). **Decode it before passing it to
`createMerchantClient`** — `Buffer.from(secret, "hex")` in Node, or your
language's equivalent — or every call fails with `invalid_signature`,
because you'd be signing with the hex string's own UTF-8 bytes rather than
the key `services/voucher` actually holds. `createMerchantClient`'s
`secret` option accepts a `Uint8Array` for exactly this reason.

## The four calls

Every call is a `POST` to the voucher service, request and response
bodies are JSON, and every amount is an **integer in minor units** with an
explicit `currency` (`AUD` has 2 decimal places, `IDR` has 0 — never send
a float).

| Method              | Route                         | Purpose                                                                                                        |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `authorize(params)` | `POST /v1/vouchers/authorize` | Look up a voucher by `code` (or a scanned QR token) and reserve an amount against it. Does not move value yet. |
| `capture(params)`   | `POST /v1/vouchers/capture`   | Finalizes a prior authorization for the actual amount charged (may be less than authorized, never more).       |
| `void(params)`      | `POST /v1/vouchers/void`      | Cancels an authorization that was never captured (the customer walked away, the till voided the sale).         |
| `refund(params)`    | `POST /v1/vouchers/refund`    | Reverses some or all of a capture, identified by your own `refundRef`.                                         |

```ts
interface AuthorizeParams {
  code: string;
  amountMinor: number;
  currency: "AUD" | "IDR";
  merchantOrderRef?: string;
  orderTotalMinor?: number; // the whole basket — minimum-spend vouchers are checked against THIS, not amountMinor
}

interface CaptureParams {
  authorizationId: string;
  finalAmountMinor: number;
}

interface VoidParams {
  authorizationId: string;
}

interface RefundParams {
  receiptId: string;
  amountMinor: number;
  reason: string;
  refundRef: string; // your own reference; reusing one that already succeeded is what makes a retry safe
}
```

A counter device's credential can never void or refund (TASKS.md 8.2.c) —
those calls are refused with a 403 for a device-scoped key. Only a
merchant-wide key (issued from Studio → Developers, not a paired counter
device) can.

## Signing

Every request carries an `X-YourTal-Signature` header:

```
X-YourTal-Signature: t=<unix seconds>,k=<key id>,v1=<hex hmac-sha256>
```

The MAC covers a canonical string, newline-joined so no field can contain
the separator:

```
<unix timestamp>
<key id>
<HTTP METHOD, upper-case>
<path and query string, exactly as sent>
<Idempotency-Key header value, or "" if you sent none>
<base64(sha256(request body))>
```

`HMAC-SHA256(secret, canonical string)`, hex-encoded, is the `v1=` value.
This is **byte-identical** to the Go verifier the voucher service actually
runs (`services/voucher/internal/merchantauth/signing.go`) — this SDK's
own `signRequest` implements exactly this and is proven against vectors
generated by calling that Go code directly (`src/signing.test.ts`), not
just checked against itself.

Every field is signed for a reason:

- **no body hash** → the amount or order reference could be changed
  under a valid signature
- **no path** → a capture could be replayed as a refund
- **no method** → likewise
- **no timestamp** → a captured request would be replayable forever
  (the server accepts a timestamp within 5 minutes of its own clock,
  either direction)
- **no Idempotency-Key** → a logged request could be replayed under a
  fresh key and treated as new
- **no key id** → a signature would be ambiguous during a key rotation

If you're implementing this in another language, `signRequest` in
`src/signing.ts` is under 40 lines and is the reference — port it
directly rather than reimplementing from this description alone.

## Idempotency

Every call the SDK makes carries an `Idempotency-Key` header, generated
once per logical call (one UUID per `authorize`/`capture`/`void`/`refund`
invocation) and sent unchanged on every retry of that same call, with the
identical request body. The server treats a repeated key + body as "give
me the answer to that same request again", not as a new one — this is
what makes automatic retries (below) safe to enable by default: a
duplicate arrival due to a slow or dropped response never double-charges
a voucher.

If you build your own retry loop instead of using this SDK's built-in one
(for example, retrying `client.capture()` yourself at a higher level),
generate your own idempotency key per logical attempt and pass it through
consistently — never let two different logical operations share one.

## Retries

Configurable via the `retry` option to `createMerchantClient`:

```ts
createMerchantClient({
  baseUrl,
  keyId,
  secret,
  retry: {
    maxAttempts: 4, // default: 4 (1 try + 3 retries)
    baseDelayMs: 250, // default: 250
    maxDelayMs: 8000, // default: 8000
  },
});
```

Only these are retried:

- a network error (the request never got a response at all);
- HTTP `429` (rate limited);
- any HTTP `>= 500`.

Everything else — a `400`/`401`/`403`/`404`, or any other business error —
is a fact about the request that a retry cannot change, and is thrown
immediately. Backoff is capped exponential with full jitter (uniform over
`[0, min(maxDelayMs, baseDelayMs * 2^attempt)]`); a `Retry-After` header on
a `429`/`503` is honoured over the computed delay, still capped at
`maxDelayMs`.

## Errors

```ts
import { MerchantApiError, MerchantNetworkError } from "@yourtal/sdk-merchant/errors";

try {
  await client.authorize({ code, amountMinor, currency: "AUD" });
} catch (error) {
  if (error instanceof MerchantApiError) {
    // error.code, e.g. "voucher_not_found", "already_redeemed", "expired"
    // error.httpStatus, error.type, error.param
  } else if (error instanceof MerchantNetworkError) {
    // the request never reached the server, or never got a response
  }
}
```

`MerchantApiError` carries the server's own `type`/`code`/`message`/`param`
— branch on `code`, never on parsing `message`, since that string is meant
for a human, not your integration.

## Webhooks

Register a delivery URL from Studio → Developers (TASKS.md 8.3.a) and a
worker job (`apps/worker/src/jobs/webhook-delivery.ts`) signs and sends you
a `voucher.captured`, `voucher.refunded` or `voucher.expired` event after
each one happens — `{ event, data }`, plus a signature.

The signature is a **different, simpler** scheme than request signing
above: there is no method, path or key id to bind for an inbound delivery,
only a body your server reads once.

```
t=<unix seconds>,v1=<hex hmac-sha256>
```

`HMAC-SHA256(secret, "${t}.${rawBody}")`, hex-encoded, where `rawBody` is
the exact bytes of `JSON.stringify({ event, data })` — signed before
anything else was added to what you receive, so verify against exactly
those two keys, in that order, not against whatever else your transport
wraps them in.

```ts
import { verifyWebhookSignature, WebhookSignatureError } from "@yourtal/sdk-merchant/webhook";

// rawBody: the exact request body bytes your server received, as a string.
// signatureHeader: wherever your receiver read the "t=...,v1=..." value from.
try {
  verifyWebhookSignature({
    rawBody,
    signatureHeader,
    secret: process.env.MERCHANT_WEBHOOK_SECRET!,
  });
  // verified — safe to act on the event now
} catch (error) {
  if (error instanceof WebhookSignatureError) {
    // bad signature, tampered body, or a stale/future timestamp outside
    // the tolerance window (5 minutes by default; pass toleranceSeconds
    // to change it) — refuse the delivery, do not act on it
  }
}
```

`verifyWebhookSignature` throws `WebhookSignatureError` on any failure —
wrong secret, a body edited after signing, a malformed header, or a
timestamp too far from your server's own clock — rather than returning a
boolean a caller could forget to check. The MAC comparison is constant-time
(`crypto.timingSafeEqual`), so a timing side-channel cannot leak the correct
signature one byte at a time.

8.2's webhook driver is simulated-only (docs/23, red line 11: no real
outbound HTTP call ever leaves YourTal's worker), so on staging there is no
real HTTP receiver to test against yet — a delivery is inspectable as a row
in `platform.sim_outbox` instead, shaped `{ event, data, signatureHeader }`.
`verifySimulatedWebhookDelivery(delivery, secret)` reconstructs `rawBody`
from that shape for you, so you can verify a simulated delivery the same
way you'll verify a real one once a live receiver exists:

```ts
import { verifySimulatedWebhookDelivery } from "@yourtal/sdk-merchant/webhook";

verifySimulatedWebhookDelivery(
  {
    event: row.category,
    data: JSON.parse(row.body).data,
    signatureHeader: JSON.parse(row.body).signatureHeader,
  },
  secret,
);
```

If you're implementing this in another language, `verifyWebhookSignature`
in `src/webhook.ts` is under 40 lines of actual logic and is the
reference — port it directly. `src/webhook.test.ts` cross-checks it
against a transcribed copy of the worker's own signing function, so a
drift between the two would fail that test first.

## Known gaps

- `authorize` accepts a voucher `code` only today. Accepting a scanned,
  rotating QR token (TASKS.md 4.5.b) as an alternative to `code` is not
  yet wired up server-side.
