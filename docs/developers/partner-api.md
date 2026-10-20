# YourTal partner API: earning points for receipts

For developers of a partner app (SnapApp first) that reports what its users do, so YourTal can pay them points. Your server calls YourTal; the user's device never does, because the requests are signed with a secret only your server holds.

The machine-readable contract is `POST /api/partners/links` and `POST /api/partners/actions` in [`packages/contracts/openapi/yourtal.openapi.json`](../../packages/contracts/openapi/yourtal.openapi.json). This page explains how to use them.

## Before you start

You get three things from YourTal, out of band:

| What           | Example                                | Notes                                                                            |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| Partner id     | `snap-app`                             | Goes in every `Authorization` header.                                            |
| Signing secret | a long random string                   | Keep it on your server only. Never ship it in an app, log it, or commit it.      |
| Base URL       | `https://yourtal.gaiada.com` (staging) | Every path below is relative to it. Production's host is given to you at launch. |

## 1. Linking a user's account

A user links once. After that you name them by a **link id** for as long as they stay linked.

1. In YourTal, the user opens **Me → Linked apps** and taps **Generate code**. They get an 8-character code (letters A–Z without I and O, digits 2–9), valid for **10 minutes** and usable **once**.
2. The user types the code into your app.
3. Your server exchanges it for a link:

```http
POST /api/partners/links
Authorization: Partner snap-app:<signature>
Content-Type: application/json
Idempotency-Key: <a fresh UUID per request>

{"code":"K7QM4XPA"}
```

```json
{
  "linkId": "3f1c2a7e-8b4d-4c1e-9a6f-2d5b7c8e9f01",
  "region": "AU",
  "createdAt": "2026-10-20T03:15:00.000Z"
}
```

4. Store `linkId` against your user. You never need the code again, and you can't use it again.

Good to know:

- **One link per user per partner.** If an already-linked user generates a new code and you exchange it, you get the same `linkId` back.
- **`region`** is `AU` or `ID`. The user earns in their own region's points and nothing crosses between the two. Use it if you show a points rate in your app.
- **Teen accounts can't link.** YourTal doesn't issue them a code, and if one reaches you anyway the exchange answers `403 teen_consent_not_allowed`. Tell the user that only adult accounts can earn points for receipts.
- **A link ends in one of three ways.** The user taps **Unlink** under Me → Linked apps in YourTal; the user deletes their YourTal account; or you revoke it (below). Either way your next call with that `linkId` answers `403 link_revoked` and pays nothing: forget the link id and offer to link again. A new code then gives a new `linkId`. After an account is deleted, its unused codes stop working too.
- **Shortcut.** You can skip step 3 and send the code as `user` in the user's first receipt call (below). That call creates the link and returns `linkId` too. Exchanging the code straight away is better, because the code expires after 10 minutes and the user may not scan a receipt that soon.

### Revoking a link from your side

When a user unlinks YourTal in your app, or deletes their account with you, end the link so it can't earn again:

```http
POST /api/partners/links/3f1c2a7e-8b4d-4c1e-9a6f-2d5b7c8e9f01/revoke
Authorization: Partner snap-app:<signature of the body {}>
Content-Type: application/json
Idempotency-Key: <a fresh UUID per request>

{}
```

```json
{ "linkId": "3f1c2a7e-8b4d-4c1e-9a6f-2d5b7c8e9f01", "revokedAt": "2026-10-21T08:00:00.000Z" }
```

Send the body `{}` and sign it like any other body. Revoking a link that is already revoked (by you, by the user, or by an account deletion) answers `200` with the original `revokedAt`, so a retry is always safe. You can revoke only your own links: another partner's link id, or one that doesn't exist, answers `400 unknown_link`.

## 2. Reporting a receipt

```http
POST /api/partners/actions
Authorization: Partner snap-app:<signature>
Content-Type: application/json
Idempotency-Key: <a fresh UUID per request>

{"linkId":"3f1c2a7e-8b4d-4c1e-9a6f-2d5b7c8e9f01","action":"receipt_scanned","externalRef":"rcpt_5d41402abc4b2a76b9719d911017c592","evidence":{"store":"Cafe Giro","totalMinor":450}}
```

| Field         | Required         | Meaning                                                                                                                               |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `linkId`      | one of these two | The link from step 1.                                                                                                                 |
| `user`        | one of these two | A one-time link code instead of `linkId` (the shortcut above). Send exactly one of `linkId` and `user`.                               |
| `action`      | yes              | `receipt_scanned`, the only action today.                                                                                             |
| `externalRef` | yes              | Your stable id for this physical receipt, such as a hash of its content. **One receipt earns once per partner**, keyed on this value. |
| `evidence`    | no               | Any JSON object you want kept with the grant for audit (an OCR summary, a photo reference). YourTal stores it and never parses it.    |

The answer is always `200` once the user is linked and the receipt is accepted:

```json
{
  "granted": true,
  "points": 10,
  "linkId": "3f1c2a7e-8b4d-4c1e-9a6f-2d5b7c8e9f01",
  "duplicate": false
}
```

| Field       | Meaning                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `granted`   | This receipt has earned points for this user, on this call or an earlier one.                                        |
| `points`    | How many. Today 10 in AU and 100 in ID; YourTal can change the rate, so show this number rather than a constant.     |
| `linkId`    | The user's link. Store it if you sent a code.                                                                        |
| `duplicate` | `true` when this receipt had already been reported. **Nothing new was paid.** Treat it as success and stop retrying. |

A receipt that was first reported for a different user answers `{"granted": false, "points": 0, "duplicate": true, ...}`: it earns once, for whoever reported it first.

YourTal may hold new points for a while before the user can spend them; that is YourTal's setting and needs nothing from you. A user can earn for a limited number of receipts a day (currently 10); past that the call answers `409 velocity_capped`.

## 3. Signing a request

Every request carries:

```
Authorization: Partner <partner id>:<signature>
```

`<signature>` is **HMAC-SHA256**, written as **64 lowercase hex characters**, where:

- the **key** is your signing secret's UTF-8 bytes, used as given (it is not hex- or base64-decoded first);
- the **message** is the **exact bytes of the HTTP request body**, nothing else. The method, path, query and headers are not signed.

Serialise the body once, sign those bytes, and send those same bytes. Re-serialising after signing (pretty-printing, reordering keys, a client library adding a newline) changes the bytes and the signature fails with `401 invalid_partner_signature`. Send `Content-Type: application/json`.

Check your implementation against these two vectors, signed with the secret `example-secret-not-real` (each body is exactly the text shown, with no trailing newline):

| Body                                                                                                                                                                                   | Signature                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `{"code":"K7QM4XPA"}`                                                                                                                                                                  | `7ce9dd173825a395e170a772a0929b391477065dc8ca0a9e91c33587c20c1607` |
| `{"linkId":"3f1c2a7e-8b4d-4c1e-9a6f-2d5b7c8e9f01","action":"receipt_scanned","externalRef":"rcpt_5d41402abc4b2a76b9719d911017c592","evidence":{"store":"Cafe Giro","totalMinor":450}}` | `fe552000b602916a045bf117f3a57a254d0b8616e3258c4faabda66c8f3853c9` |

The signature has no timestamp, so a copied request could be sent again. That pays nothing extra: a receipt earns once and a link is created once. Keep the secret on your server, and always use HTTPS.

## 4. Idempotency and retries

Every call needs an `Idempotency-Key` header: a fresh UUID per logical request (UUIDv7 recommended). Keys are scoped to your partner id and kept for 24 hours.

| You send                                           | YourTal answers                                                |
| -------------------------------------------------- | -------------------------------------------------------------- |
| The same key and the same body again               | The original answer, without doing the work twice.             |
| The same key with a different body                 | `409 idempotency_key_reused`. Use a new key for a new request. |
| The same key while the first call is still running | `409 idempotency_request_in_progress`. Wait and retry.         |
| No key                                             | `400 idempotency_key_required`.                                |

How to retry:

- **Network error, timeout, `5xx` or `429`:** retry with the **same key and the same body bytes**, backing off exponentially (for example 1 s, 2 s, 4 s, up to a few minutes). On `429`, wait at least `retryAfterSeconds` from the body. A retried link exchange returns the same `linkId`, even though the code itself is spent.
- **Any other `4xx`:** don't retry the same request. Fix the cause (see the table below).
- **Lost track of a receipt?** Report it again under a new key. If it already counted you get `200` with `duplicate: true`; it never pays twice.
- **A receipt refused by the ledger** (`409 velocity_capped` and the other ledger codes in section 5) has been recorded but not paid. Reporting it again later, under a new key, can still pay it **once**, if the user is then within their daily limit; the answer is `200` with `granted: true` and `duplicate: true`, because the receipt itself was already reported. It never pays more than once.

## 5. Errors

Every error body has a stable `code` and a readable `message`. Switch on `code`, not on the message.

```json
{ "code": "link_revoked", "message": "the user unlinked this app; ask them to link again" }
```

| Status | `code`                                                               | Meaning, and what to do                                                                                                                                     |
| ------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_link_code`                                                  | The code is unknown, expired (10 minutes) or already used. Ask the user for a new code.                                                                     |
| 400    | `unknown_link`                                                       | No link with this id exists for your partner id. Forget the stored link id and link again.                                                                  |
| 400    | `idempotency_key_required`                                           | Add an `Idempotency-Key` header.                                                                                                                            |
| 400    | (validation)                                                         | The body doesn't match the schema, for example both or neither of `linkId` and `user`. The body lists the problems.                                         |
| 401    | `invalid_partner_signature`                                          | Wrong partner id, wrong secret, or the signed bytes are not the sent bytes (section 3).                                                                     |
| 403    | `link_revoked`                                                       | The link ended: the user unlinked your app, deleted their YourTal account, or you revoked it. Nothing was paid. Forget the link id and offer to link again. |
| 403    | `teen_consent_not_allowed`                                           | A teen account can't link a partner app.                                                                                                                    |
| 409    | `velocity_capped`                                                    | The user reached the daily receipt limit, or the earn was refused as unusual. Nothing was paid. You may report the receipt again tomorrow.                  |
| 409    | `insufficient_available`, `solvency_blocked`, `allocation_exhausted` | YourTal can't fund points right now. Nothing was paid. Retry later under a new key.                                                                         |
| 409    | `idempotency_key_reused`, `idempotency_request_in_progress`          | See section 4.                                                                                                                                              |
| 429    | (none; `retryAfterSeconds` in body)                                  | Too many requests: about 120 a minute for receipts and 60 a minute for link exchanges, per source IP. Back off and retry.                                   |
| 503    | `persistence_unavailable`                                            | A temporary fault on YourTal's side. Retry with the same key.                                                                                               |

If a call that sent a code (`user`) links the user and then fails on the receipt, the error body also carries `linkId`. Store it, because the code can't be used again.

## Example: curl

```bash
SECRET='example-secret-not-real'   # your real secret comes from your secret store
BODY='{"linkId":"3f1c2a7e-8b4d-4c1e-9a6f-2d5b7c8e9f01","action":"receipt_scanned","externalRef":"rcpt_5d41402abc4b2a76b9719d911017c592","evidence":{"store":"Cafe Giro","totalMinor":450}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')

curl -sS https://yourtal.gaiada.com/api/partners/actions \
  -H "Authorization: Partner snap-app:$SIG" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data-binary "$BODY"
```

Use `--data-binary`, not `-d`: `-d` can alter the bytes you signed.

## Example: TypeScript (Node 20+)

```ts
import { createHmac, randomUUID } from "node:crypto";

const BASE_URL = "https://yourtal.gaiada.com";
const PARTNER_ID = "snap-app";
const SECRET = process.env.YOURTAL_PARTNER_SECRET ?? ""; // never hard-code it

async function callYourTal<T>(path: string, body: unknown, idempotencyKey = randomUUID()) {
  const raw = JSON.stringify(body); // serialise once; sign and send these exact bytes
  const signature = createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Partner ${PARTNER_ID}:${signature}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey, // reuse it when retrying this same request
    },
    body: raw,
  });
  const json = (await response.json()) as T & { code?: string; linkId?: string };
  return { status: response.status, body: json };
}

// Once, when the user types their code into your app:
const linked = await callYourTal<{ linkId: string; region: "AU" | "ID" }>("/api/partners/links", {
  code: "K7QM4XPA",
});
if (linked.status !== 200) throw new Error(`link failed: ${linked.body.code}`);
const linkId = linked.body.linkId; // store this against your user

// For every confirmed receipt:
const earned = await callYourTal<{ granted: boolean; points: number; duplicate: boolean }>(
  "/api/partners/actions",
  { linkId, action: "receipt_scanned", externalRef: "rcpt_5d41402abc4b2a76b9719d911017c592" },
);
if (earned.status === 403 && earned.body.code === "link_revoked") {
  // forget linkId and ask the user to link again
}
```
