# YourTal — The SnapApp scans voucher: swap points for scans

**Date:** 2026-10-22 · **Status:** Agreed. Designed for group task 2.8 (YourTal 14.23); the founder answered its questions on 2026-10-21 and 2026-10-22 (F128).
**Builds on:** docs/09 §8 (authorize, capture, void), 8.3.f (Studio credentials), F117 (partner links), F127 and [`27`](27-receipt-packages.md) (receipt packages), F105 and F112 (teens), F54 (B stays off the wire), 10.1 (settlement).
**Feeds:** group 2.8.b–e.

A viewer spends points on a "50 SnapApp scans" voucher in YourTal's store and types its code into SnapApp. SnapApp asks YourTal whether that code is in the wallet of the YourTal account linked to this SnapApp user. If it is, SnapApp redeems the voucher through YourTal's merchant voucher API as Snap App Pty Ltd and adds 50 credits, exactly once. YourTal owes Snap App A$5 for each redemption and pays it through the usual weekly statement.

## 1. Decisions (F128)

| Question | Answer |
| --- | --- |
| The voucher | One listing, AU only: **A$5 face = 50 scans (10c a scan), settlement value S = A$5, priced at 200 points** (above the 3c backing, 167 points, so YourTal keeps A$1 of backing per voucher and the rate is not readable from the price). |
| Who may redeem | Only the SnapApp account linked to the YourTal wallet that holds the voucher. Adults only (teens: F105, F112). |
| Who may buy | Partner-bound listings skip the store's trust-tier-2 rule for online vouchers: the code works only in the holder's linked SnapApp account, so it cannot be resold. Teens are still refused. |
| Money between the companies | None netted: YourTal's payouts to Snap App and Snap App's receipt-package purchases stay separate flows. |

Defaults taken by the lead (no founder input needed): ownership is checked by a new partner-API read before any hold (D1); a listing is bound to a partner by `store.listings.redeem_partner_id`, set by staff only (D2); a bound listing cannot be gifted or auctioned (D3); credits go to the workspace the person redeems in, owner or admin only (D4); buying needs no link, the listing text says how to use it (D5); SnapApp never stores the code, only its SHA-256, and never retries an authorize from the background (D6); a new merchant order lookup resolves every unknown outcome (D7); only AUD 500 maps to 50 scans (D8); redemption is offered to AU links only (D9).

## 2. Today's code (findings that shaped the design)

- The merchant API is `POST /v1/vouchers/{authorize,capture,void,refund}` (`services/voucher/internal/redeem/routes.go`), signed `X-YourTal-Signature: t=,k=,v1=` with a Studio credential (`mc_<uuid>` + 32 bytes shown as 64 hex; only such a credential may void). Every route needs an Idempotency-Key; keys are per merchant for 24 h; **every answer is stored and replayed, 5xx included**, and a key sat in progress 5 minutes runs again (`idempotency/claim.go`, `db/query/idempotency.sql`). So a capture that answered 404 can still have succeeded: hence the lookup (§4.3).
- Authorize refuses an unknown code, the wrong merchant, an inactive voucher and too little value with one answer, `402 authorization_refused`; **20 failed lookups in 5 minutes throttle the whole merchant** (`redeem.go`), and every SnapApp user redeems as the same merchant: hence the ownership read first and the local check symbol. A hold lasts 15 minutes; one live hold per voucher and one authorization per order; after a void a retry needs a new `merchant_order_ref`; `remaining_balance` is the value before the hold.
- Codes are 16 Crockford Base32 symbols plus a mod-37 check symbol **that may be `*`, `~`, `$`, `=` or `U`** (`internal/code/code.go`); I/L fold to 1, O to 0; only the SHA-256 is stored.
- **Checkout refuses any `online` listing below trust tier 2** (`checkout/use-cases/quote-checkout.ts`); F128 exempts bound listings.
- The wallet shows a QR and "show this code to the cashier" (`voucher-detail-view.tsx`); bound vouchers need app instructions instead.
- Snap App Pty Ltd (…0001, AU, roles advertiser, supplier, redeemer) is seeded. A purchase books Dr redemption_clearing / Cr voucher_liability; a capture moves S to merchant_payable; weekly statements, a 7-day dispute window, two staff approve, Connect payout (10.1, 14.8). Point purchases appear on statements for information only, so no netting work is needed.
- SnapApp: no redeem route (the stub went in 9f43742); the partner client is `apps/server/src/yourtal/client.ts`; secrets come from `YOURTAL_ENV_FILE` (`/etc/snap-apps/secrets/yourtal.env`, mounted as a single file, first matching line wins); `usage_grants.source` is free text, and only a grant backed by a paid `credit_purchases` row counts as paid (so voucher scans earn no receipt points, `skipped_free`); the next free migration is 0041 or later.

## 3. The flow

**Buy (YourTal).** The viewer checks out "50 SnapApp scans" (200 points). The wallet shows the code, a Copy button and "Use it in SnapApp" (§4.4).

**Redeem (SnapApp, `POST /v1/yourtal/vouchers/redeem {code}`, with the workspace header).**

1. Guards: own session (no staff impersonation), verified email, owner or admin of the workspace, a live AU link, the partner and merchant settings present, at most 5 attempts per 15 minutes.
2. Parse and normalise the code locally (a port of the Go parser); keep `code_sha256`. A typo fails the check symbol and never reaches YourTal.
3. Seen before? A granted redemption for this hash → `409 already_redeemed` with the date, no call. In progress → `202 pending`.
4. Ask YourTal who holds it: `POST /api/partners/vouchers/owner {linkId, codeSha256}`. Not held → `409 not_your_voucher`, no hold, no throttle count. Held but redeemed, expired or held → `voucher_used`, `voucher_expired`, `voucher_busy`. Face ≠ 500 or currency ≠ AUD → `not_a_scans_voucher`.
5. Write the redemption row (`authorizing`, `merchant_order_ref = snap-<id>`, three fresh keys) and commit it before any value-moving call.
6. Authorize `{code, amount: 500, currency: "AUD", merchant_order_ref, order_total: 500}`; `amount_authorized` and `remaining_balance` must both be 500, else void and refuse.
7. Capture `{authorization_id, final_amount: 500}`; record `receipt_id`.
8. Grant, in one transaction: `usage_grants(…, 'scans', 50, 50, 'yourtal_voucher')` in the workspace; set `grant_id`, status `granted`. No `credit_purchases` row.
9. Answer `200 granted`, or `202 pending` when an outcome is unknown and the worker will finish (§5, S4).

**When something goes wrong** (the rules): a lost authorize answer → the worker looks the order up (held: capture; not found after 17 min: `abandoned`); an expired hold → `expired`, a retry uses a new order ref; a lost capture answer → retry with the same key, and after a 404 or 23 h look it up; capture 5xx, `409 retry` or the kill switch → void; **captured but the grant failed → retry the grant only, never capture again and never void** (a redeemed single-use voucher cannot be refunded); a revoked link → `link_broken`; stuck 3 days or an unwritable grant → `needs_review` with an alert.

## 4. YourTal design

### 4.1 Partner-bound listings (T1)

`store.listings.redeem_partner_id text NULL REFERENCES platform.partner_credential(partner_id)`, with a CHECK that a bound listing is online, not transferable and `single_use_forfeit`. Set by staff only (the seed on staging; one reviewed SQL line in production until a staff action exists). Mirrored in `services/voucher/db/schema.sql` and exempted in the contracts drift test.

### 4.2 The ownership read (T2 voucher service, T4 partner API)

`POST /api/partners/vouchers/owner` (partner HMAC, not value-moving, 60/min per IP). Request `{linkId, codeSha256}`. Held: `{linkId, held: true, status: active|held|redeemed|expired, faceValueMinor, currency, expiresAt}`; every other case the identical `{linkId, held: false}`. Errors `400 unknown_link`, `403 link_revoked`, `400` malformed, `401` bad signature. It resolves the active link (adults only), calls a new internal read `POST /internal/v1/vouchers/holding {codeSha256, ownerId}` that answers facts only when `owner_id` matches, and says held only if the listing's `redeem_partner_id` is the calling partner and the region matches the link. Never returns voucher, listing or merchant ids or the hash. Privacy: SnapApp learns only whether a code its own user typed is in that user's linked wallet; YourTal sees the hash, never the code.

### 4.3 The order lookup (T3)

`POST /v1/vouchers/lookup {merchant_order_ref}` (merchant HMAC; a fresh Idempotency-Key per lookup) → `{authorization_id, state: held|captured|voided|expired, amount_authorized, expires_at, receipt_id?, amount_captured?}`; a hold past expiry reads expired before the sweep; another merchant's or an unknown order → `404 order_not_found`; never counted as a failed attempt. Added to `packages/sdk-merchant` with its README (and the README's wrong "sandbox catalogue" sentence corrected).

### 4.4 Wallet (T5)

`GET /api/wallet/vouchers/:id` adds `redeemIn: {partnerId}` for a bound voucher. The page then shows the code with Copy, no QR and no branch, and: "Open SnapApp, go to Points, choose Use a YourTal voucher and enter this code. Only the SnapApp account linked to your YourTal account can use it." (en-AU and id-ID).

### 4.5 Checkout (T6)

`quote-checkout.ts` skips the tier-2 rule when `listing.redeemPartnerId !== null`; the adult audience check stays.

### 4.6 Staging data and the credential (T7, then the lead)

Seed (staging and dev, idempotent): location "SnapApp (online)"; listing "50 SnapApp scans" for Snap App Pty Ltd, AU/AUD, face 500, S 500, online, audience adult, `single_use_forfeit` / `single_use`, not transferable, `redeem_partner_id = 'snap-app'`, **priced at 200 points** (find how a listing's point price is set above S ÷ B: the demand multiplier or an explicit price; if nothing allows it, a tiny ticket adds a per-listing price override), description: "Adds 50 receipt scans to SnapApp. Link SnapApp under Me → Linked apps, then in SnapApp open Points, choose Use a YourTal voucher and enter the code. Only the SnapApp account linked to this YourTal account can use it. Single use." Stock kept at 50 minted vouchers (requester and approver differ).

Lead, on helios: L1 issue a Studio credential for business …0001 as owner.au ("SnapApp scans", never print the secret); L2 add `YOURTAL_MERCHANT_KEY_ID=` and `YOURTAL_MERCHANT_SECRET=` to `/etc/snap-apps/secrets/yourtal.env` and recreate the snap-apps api and worker; L3 set up Snap App's simulated payout account in Studio → Billing → Payouts before Phase C. Production waits for group 6.1.

## 5. SnapApp design

- **S1 (migration 0041+, add-only):** `yourtal_voucher_redemptions` with `code_sha256` (never the code), `merchant_order_ref` unique, three unique keys, write-once `authorization_id`, `receipt_id`, `grant_id`, a status machine (`authorizing → authorized|captured|voided|expired|refused|abandoned|failed`, `authorized → capturing|voiding|captured|expired`, `capturing → captured|voiding|voided|expired|needs_review`, `captured → granted|needs_review`, `voiding → voided|expired|captured`, `needs_review → captured|granted|voided|expired`; finals never move) enforced by a BEFORE UPDATE trigger, a unique index on in-progress or granted hashes, a deferred trigger that lets a `usage_grants` row with `source = 'yourtal_voucher'` commit only with exactly one `granted` redemption pointing at it with the same credits; RLS forced (the API inserts only `authorizing` rows of its own in its workspace and never deletes; the worker has full access); declared in `packages/db/src/schema/yourtal.ts`.
- **S2:** settings `YOURTAL_MERCHANT_KEY_ID` and `YOURTAL_MERCHANT_SECRET` (64 hex → 32 bytes) read like the partner secret, a malformed value turning the feature off with one log line; `merchant-signing.ts` (a port of `packages/sdk-merchant/src/signing.ts` plus a verifier for the fake); `voucher-code.ts` (Parse, Normalise, Format); `merchant-client.ts` (authorize, capture, void, lookup; sends exactly the bytes it signed, `redirect: 'error'`, 8 s timeout, parses `{error:{code}}` and `Idempotent-Replay`, never logs a body); `voucherOwner()` on the partner client.
- **S3:** `fake-yourtal-vouchers.ts` copying the Go behaviour (signatures, stored and replayed answers incl. 5xx, in-progress 409, 15-minute holds on an injectable clock, one hold per voucher, single use, void needs a live hold, the lookup, the 20-in-5 throttle, `inject()`), and the ownership read in `fake-yourtal.ts`.
- **S4 (money core):** the endpoint, repo, state machine, grant and worker drain (claims due rows with a lease; backoff 15 s doubling to 15 min; `authorizing` older than 30 s → lookup; `authorized` → capture while live; `capturing` → retry same key, 404 or 23 h → lookup; `captured` → grant; `voiding` → retry, 404 → lookup; 3 days stuck or 24 h of grant failures → `needs_review`). Key rules: a key is written before its first send and reused on every retry; any response, even a replayed 5xx, is final for that key; a capture counts only on 200 or a lookup saying captured; after a capture has been sent, void only if a lookup says the hold is still live; external calls never run inside a database transaction; the grant locks the row and requires `captured` with `grant_id` NULL. Status: `YourtalLinkStatus` gains `vouchers: {available, reason?, redemptions[]}`.
- **S5 web, S6 phone:** "Use a YourTal voucher" card on Points when linked and available: field "Voucher code" (`XXXX-XXXX-XXXX-XXXX-X`), button "Add scans", hint "Only the YourTal account linked here can use its vouchers. Scans from a voucher don't earn YourTal points.", success "50 scans added to {workspace}.", pending "Adding 50 scans. This can take a minute.", and one sentence per error code (not_your_voucher: "That code isn't a scans voucher in the YourTal wallet linked to this account."; already_redeemed: "This voucher was already used: 50 scans were added on {date}."; voucher_busy; yourtal_unavailable: "YourTal isn't answering right now. Nothing was taken. Try again in a minute."); a history row per redemption.
- **S7:** the monitor flags `needs_review` or `captured` for more than an hour; DEPLOY.md documents the two settings and rotation (edit the line in place, recreate api and worker); ECOSYSTEM.md D33 mentions voucher credits.

## 6. The money

Per redemption: purchase burns 200 points and books Dr redemption_clearing / Cr voucher_liability 500; capture owes PayableShare(500, 500, 0, 500) = 500, posted Dr voucher_liability / Cr merchant_payable(Snap App Pty Ltd, AU); the weekly statement, the 7-day window, two staff, and the Connect payout (Dr merchant_payable / Cr reserve): A$5 reaches Snap App 8 to 14 days after the redemption. An expired unused voucher releases the liability; nothing is paid. The extra 33 points of backing per voucher stay in the reserve. Studio: Billing → Statements and Payouts; staff: /staff/settlement.

## 7. Rollout (every push to main deploys)

1. T1 (with its Go schema mirror). 2. T2 and T3 (T2 live before T4 merges). 3. T4, T5, T6, T7. 4. L1. 5. S1 → S2 → S3 → S4 (S4 deploys dark without the merchant settings). 6. **L2 turns SnapApp on only after T3, T4 and T7 are live.** 7. S5, S6, S7 (they render only when the server says `vouchers.available`). 8. T8: Phase A after step 3, Phase B after step 7, Phase C after the statement's dispute window.

## 8. Staging check (T8, `scripts/check-2.8-scans-voucher.mjs`)

Phase A: viewer.au sees the listing (A$5.00, online, 200 points, stock > 0); owner.au's Studio → Developers lists the credential; the ownership read answers `{held:false}` for a random hash and 400 for an unknown link; a teen cannot quote it; a tier-0 adult can. Phase B: demo adult A links the SnapApp check account, buys the voucher, the wallet shows `redeemIn: snap-app`; redeem in SnapApp → `200 granted`, +50 credits, status lists it; the voucher reads redeemed; the same code again → `409 already_redeemed`; adult B's code typed by A → `409 not_your_voucher`, B's voucher stays active; a scan on voucher credits is `skipped_free`. Phase C (8+ days later): the statement shows the captures; two finance staff approve; Studio → Payouts shows it paid.

## 9. Tickets

| Ticket | Owner | Owns | Needs |
| --- | --- | --- | --- |
| T1 Partner-bound listings | senior-db, Sonnet | migration + atlas.sum; voucher schema.sql; listing.table.ts; schema-drift test | — |
| T2 Voucher service holding read + code test vectors | senior-be, Sonnet | `internal/api/holding_routes.go`; `db/query/issue.sql` + sqlc; `code_test.go` TestParseVectors; `contracts/src/voucher-internal/wallet.ts`; voucher-client (http, fake, spec) | T1 |
| T3 Merchant order lookup (money read) | senior-be, Sonnet | `redeem/lookup.go`; routes, httpmap; `redeem.sql` + sqlc; authz test; `packages/sdk-merchant` | — |
| T4 Partner ownership read | senior-be, Sonnet | `partners/partner-vouchers.controller.ts`; `voucher-owner.use-case.ts`; dto; e2e + live test; contracts `device/partner-action.ts`; registry + OpenAPI; `partner-api.md` | T2 live |
| T5 Wallet: vouchers used in an app | medior, Sonnet | wallet controller + mapping; `contracts/src/wallet/wallet.ts`; `voucher-detail-view.tsx`, wallet data and cache; wallet.json en-AU, id-ID | T1 |
| T6 Checkout tier exemption | junior, Haiku | `quote-checkout.ts`, `listing-for-checkout.ts`, tests | T1 |
| T7 Staging and dev seed (incl. the 200-point price) | medior, Sonnet | `seed/demo-snapapp-scans.ts`; seed call sites; `staging.test.ts` | T1 |
| T8 Staging check | qa, Sonnet | `scripts/check-2.8-scans-voucher.mjs` | all, plus L1–L3 |
| S1 Redemption table (money core) | senior-db, Opus | `0041_yourtal_voucher_redemptions.sql`; `schema/yourtal.ts`; db test | — |
| S2 Signers, code parser, clients | medior, Sonnet | `yourtal/{merchant-signing,voucher-code,merchant-client}.ts`; `client.ts` voucherOwner; `config.ts` | T2 vectors (shapes known) |
| S3 Fake YourTal voucher service | medior, Sonnet | `test-support/fake-yourtal-vouchers.ts`; `fake-yourtal.ts` | S2 |
| S4 Redemption core (money core) | senior-be, Opus | `yourtal/{redemptions.repo,redeem.service,redemption-drain,vouchers.controller}.ts`; `yourtal.controller.ts`; `worker.ts`; `app.module.ts`; api-contract; e2e | S1, S2, S3 |
| S5 Web redeem card | medior, Sonnet | `points/YourtalVoucherCard.tsx`, view, page; `lib/yourtal-voucher.ts`; `yourtal-link.ts` hint; Credits tooltip | S4 contract |
| S6 Phone redeem panel | medior, Sonnet | `components/YourtalVoucherPanel.tsx`; `app/points.tsx`; lib; api mock | S4 contract |
| S7 Monitoring and docs | devops, Sonnet | `deploy/monitor/*`; DEPLOY.md; INTEGRATIONS.md; ECOSYSTEM.md | S4 |

Shared files: `yourtal.openapi.json` (T4 and T5; whoever merges second regenerates), `packages/api-contract/src/index.ts` (S4 writes, S5 and S6 read), `yourtal/client.ts` (S2 then S4).

## 10. Risks

The merchant throttle is shared by all SnapApp users (mitigated by the ownership read, the local check symbol and the per-user limit); an answer lost longer than a key's 24 h is resolved by the lookup, only a days-long outage reaches `needs_review`; the secret file is a single mounted file (rotate by editing in place, then recreate api and worker; Studio keeps the old key 24 h); the partner rate limit is 60/min per IP shared by every SnapApp user; A$5 reaches Snap App 8 to 14 days after a redemption; an expired voucher is breakage and the points are not returned (the listing says so); the production binding is a reviewed SQL line until a staff action exists; `channel: "both"` skips the online tier rule today (a separate YourTal task); Snap App's in-store demo vouchers are not bound, so SnapApp refuses them, by design.
