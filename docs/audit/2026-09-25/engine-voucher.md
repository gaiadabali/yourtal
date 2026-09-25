# engine-voucher: correctness audit of services/voucher and the burn and redemption surfaces

Audited 2026-09-25 against branch `tasks-audit-2026-09-21` @ `b225116`. The audit was read-only. The only commands run were `go build`, `go vet` and `go test` on `services/voucher`, with the database pointed at an unreachable port so that every test needing a DB skipped.

## 0. Verdict in one paragraph

The redemption network is the best-built part of this area. `authorize → capture → void → refund` is enforced mostly by Postgres constraints, and it holds up under concurrent writers: one live hold per voucher, one authorization per merchant order, and capture capped at the authorized amount by a composite FK. The code, keyring and HMAC primitives are sound. Everything around that network is missing or broken:

- **No path takes points and hands out a voucher.** There is no burn saga, the minter has no route, and the ledger's write routes are 501.
- **No clearing or settlement exists.** No accrual, netting, statement or payout, and `capture.settled_at` is never written.
- **The service will not boot under `docker compose`.** The keygen writes only the voucher-code key.
- **At HEAD, every voucher query breaks.** The newest migration renames the money columns the service reads.
- **Australia cannot redeem at all.** IDR is hard-coded.
- **The state machine is not enforced on redemption writes.** The table exists but is skipped there.
- **The kill switch has gaps.** It does not stop captures, and its batch scope never fires.
- **The tamper-evident chain misses deletion of the latest events.**

On the web side, the burn flow and the merchant counter are **fixture-only simulations**. The mock merchant device auth can be forged, and the counter ships every merchant's voucher codes to the browser.

## 1. Test results (pure Go, no DB)

`go build ./... && go vet ./...` are clean. `go test -count=1 ./...` with `VOUCHER_DATABASE_URL` pointed at `127.0.0.1:1`:

- **47 PASS / 39 SKIP / 0 FAIL.** The passing tests cover chain, code, httpx, keyring, lifecycle and merchantauth signing.
- All 39 skipped tests need a DB: redeem, idempotency, the merchantauth middleware and the sqlc drift guard.
- `internal/issue` has **no test files of its own**. Its only coverage comes through the redeem DB fixtures.
- The skipped `TestSqlcSchemaMatchesTheLiveDatabase` (`internal/store/schema_test.go`) is the guard that **would fail at HEAD** once migration `20260922030000` is applied (defect D1).
- No redeem test uses goroutines. Grepping for `go func` or `sync.` finds them only in `idempotency_test.go:201-204`. So "concurrent authorize is serialised" rests on index design reasoning and a sequential test (`adversarial_test.go:49`), not a concurrent one.

## 2. Requirement-by-requirement

| Requirement                                         | Status                      | Evidence                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issuance debits points exactly once, idempotently   | **missing**                 | `cmd/voucher/main.go:89` builds the minter; its only other use is a log line at `:143`. No route calls `Mint/Allocate/Activate/Reveal` (grep: only tests). `apps/api/src/modules/store/store.module.ts:45-47`: "no burn-saga". The ledger's `/transfers` returns 501 (`services/ledger/internal/api/routes.go:97-101`). `ledger.BurnPoints` (`chart.go:186`) has no non-test caller. |
| Codes unguessable                                   | **works**                   | `internal/code/code.go:74-91`: 80 bits via `b&0x1f` with no modulo bias, plus a mod-37 check symbol. Lookup uses SHA-256 (`redeem.go:200-201`). The plaintext column was dropped (`20260920000019:76`), and the app role has no grant on custody (`20260920000015:170`).                                                                                                             |
| Codes bound to the right holder                     | **by design, not bound**    | A code is a bearer instrument. `check()` (`redeem.go:221-277`) never looks at `owner_id`. The holder-bound Ed25519 QR (YT-0143) does not exist. The wallet QR is an FNV-1a hash (`apps/web/features/wallet/voucher-qr-rotation.ts:31-61`).                                                                                                                                           |
| No double redemption under concurrency              | **works (DB-enforced)**     | Partial unique index on live holds (`20260920000016:49-50`). `ResolveAuthorization` updates `WHERE state='held' AND expires_at>now()` and takes a row lock (`redeem.sql:55-59`). Voucher writes are versioned (`issue.sql:132-142`). Capture is capped by a composite FK plus a CHECK (`20260920000016:90-93`).                                                                      |
| Offline / device redemption, replay protection      | **stub**                    | The merchant portal is fixture data plus a per-device `localStorage` queue (`merchant-today-log.ts:55-87`). There is no server-side conflict rule. HMAC allows a ±5 min window with no nonce, and the `Idempotency-Key` header is not signed (D10).                                                                                                                                  |
| Expiry                                              | **partial**                 | Expiry is enforced live at authorize (`redeem.go:249`). Nothing ever sets `state='expired'`: `ListExpirableVouchers` (`issue.sql:204-208`) has no Go caller (YT-0573).                                                                                                                                                                                                               |
| Refund                                              | **partial**                 | A partial refund on a balance-carrying voucher works (`release.go:71-131`). A fully redeemed voucher is refused, which is correct under P-1. Refunds are not idempotent (D9).                                                                                                                                                                                                        |
| Transfer between users                              | **missing**                 | `TypeTransferred` and `ReasonTransfer` are declared but never emitted (`chain.go:75`, `lifecycle.go:71`).                                                                                                                                                                                                                                                                            |
| Merchant auth (HMAC, rotation)                      | **partial**                 | Verify is sound (`signing.go:128-147`, constant-time comparison). There is no code to create, rotate or revoke credentials; `InsertCredential`, `SupersedeCredential` and `RevokeCredential` are called only from tests. Compose never generates the `merchant_hmac` master key (D2).                                                                                                |
| Counter device keys (docs/17 §2.2)                  | **fixture-only, forgeable** | See D17. `voucher.authorization` has no `device_id` column, so "every redemption records the device" cannot hold.                                                                                                                                                                                                                                                                    |
| Keyring rotation                                    | **partial**                 | Multi-version open and newest-version seal work (`keyring.go:144-232`). There is no rewrap tool, so a version can never be retired.                                                                                                                                                                                                                                                  |
| Chain detects tampering                             | **partial**                 | Catches an in-place edit and a middle deletion. Does not catch deletion of the latest events, an anchored rewrite, or edits to `voucher.vouchers` (D6). `VerifyChain` has no production caller.                                                                                                                                                                                      |
| Clearing between issuing and redeeming business     | **missing**                 | YT-0160/0161/0162 are `todo` (`docs/tasks/phase-1-store.md` Clearing section). `batch.settlement_value_minor` is written (`issue.go:105`) and never read. Nothing sets `capture.settled_at`.                                                                                                                                                                                         |
| Settlement value vs points price reaches the ledger | **missing**                 | The chart has no voucher-liability or merchant-payable account (`chart.go:74-89`). Solvency coverage counts user points only (`solvency.go:83-110`) (D12).                                                                                                                                                                                                                           |
| AU / multi-currency                                 | **broken**                  | `redeem.go:241` refuses anything that is not IDR. The HEAD migration renames columns the service still reads (D1).                                                                                                                                                                                                                                                                   |

## 3. Defects (file:line and a failing scenario for each)

**D1 · critical: the HEAD migration breaks every voucher query.**
`packages/db/migrations/20260922030000_currency_tagged_money.sql:76-82` renames `face_value_idr`, `remaining_value_idr` and `minimum_spend_idr` to `*_minor`, and adds `currency NOT NULL` with no default. `services/voucher/db/schema.sql:56-59` and `db/query/issue.sql:57-61, 95-117, 132-142` still use the `_idr` names. `InsertVoucher` supplies no currency. The commit message (b225116) says only "apps/web and apps/api consumers follow in part 2"; services/voucher is not mentioned.
_Scenario:_ apply the migrations, then call `POST /v1/vouchers/authorize`. `FindVoucherByCodeHash` fails with "column v.face_value_idr does not exist", which surfaces as 500 on every authorize. `Mint` also fails. The same commit leaves `apps/web` burn and merchant code on `faceValueIdr` and `remainingValueIdr` (33 hits, e.g. `features/burn/burn-data.ts:65-72`, `merchant-redemption-screen.tsx:106`).
_Fix:_ YT-0513 part 2 must include services/voucher: schema.sql, queries, sqlc regeneration, a currency column copied from the batch, and a currency comparison against `voucher.currency`.

**D2 · high: the voucher container cannot boot under docker compose.**
`docker-compose.yml:214-218` generates only `voucher_code.v1.key`. `cmd/voucher/main.go:180` requires both `PurposeVoucherCode` and `PurposeMerchantHMAC`.
_Scenario:_ `pnpm dev:up` (or Helios) starts `yourtal-voucher`, it exits at boot with "no key is configured for this purpose: merchant_hmac", and `restart: unless-stopped` turns that into a crash loop.
_Fix:_ generate `merchant_hmac.v1.key` in the keygen, and add a CI step that boots the container.

**D3 · high: redemption writes bypass the lifecycle table.**
`issue.Move` (`internal/issue/support.go:130-174`) never calls `lifecycle.Check`. The only call is in `Minter.transition` (`support.go:92`). `place` (`settle.go:77`), `Capture` (`settle.go:196-215`), `Void` (`release.go:56`) and `Refund` (`release.go:126`) all write through `Move`.
_Scenario A (reachable today):_ a hold expires and is swept, but the voucher stays `held` (as `release.go:170-174` notes). The next authorize runs `Held→Held`, which the table forbids (`lifecycle.go:98`), and the move succeeds.
_Scenario B:_ a voucher is voided for fraud while held. `Held→Voided` is a legal move. The merchant captures: `ResolveAuthorization` still matches because the authorization is `held`, and `Move` writes `redeemed` or `active` with `void_reason=NULL`. A fraud-voided voucher comes back to life and records a capture that will be settled. `Refund` likewise restores value to a voided or expired voucher.
_Fix:_ check the table inside `Move`, add a DB trigger for the transition table, and have Capture and Void require `voucher.state='held'`.

**D4 · high: the kill switch does not stop captures, and batch scope never fires.**
`redeem.go:153-155` passes `ScopeID_2: pgtype.UUID{}`, which is NULL, so the `scope='batch' AND scope_id=$2` clause never matches. `Capture` (`settle.go:154-231`) never calls `IsKilled`.
_Scenario:_ a stolen merchant key places 20 holds. Ops enables a merchant kill switch, but every one of those holds can still be captured for up to 15 minutes. Killing a leaked batch B changes nothing: B's vouchers still authorize. The board ticks the kill switch and says batch scope is merely "not yet exercised" (`phase-1-store.md:135`).
_Fix:_ check merchant, batch (after lookup, from `voucher.batch_id`) and global scopes, both in Authorize and inside the Capture transaction. Add an enable/lift endpoint or CLI.

**D5 · medium: minimum spend is checked against the wrong number.**
`redeem.go:263-274` compares the draw `amount` with `minimum_spend`. Capture never re-checks it (`settle.go:172`), and the protocol has no order-total field.
_Scenario 1:_ a IDR 50,000 voucher with a IDR 100,000 minimum spend (a normal promo code). Authorizing 50,000 is refused as below the minimum; authorizing 100,000 is refused as insufficient value. The voucher can never be redeemed.
_Scenario 2:_ authorize 25,000 against a 25,000 minimum, then capture 1. The capture is accepted, so the threshold is bypassed.
_Fix:_ add `order_total_minor` to authorize, check it against the minimum, and bind it to the capture.

**D6 · medium: the chain misses deletion of the latest events and is not anchored.**
`chain.Verify` (`chain.go:148-174`) checks only that sequence numbers are dense from 1. A chain with its latest events removed is still dense. `chain_test.go:121-127` asserts that a truncated prefix verifies, even though the test is named `TestTruncatingTheChainIsDetected`. `tamper_test.go:73-75` claims deleting the last event is caught but actually deletes seq 2. The board repeats the claim (`phase-1-store.md:72`). `VerifyChain` (`support.go:249-274`) does not compare against `voucher.vouchers`. Heads are never exported or anchored.
_Scenario:_ the DB owner deletes the final `captured` event of voucher V, and `VerifyChain(V)` still returns nil. Raising `remaining_value` on the voucher row also leaves the chain green.
_Fix:_ assert `vouchers.version == max(seq)`. That invariant already holds, because mint sets version 1 with seq 1 and each `Move` increments both. Also replay the remaining value from event details, and anchor heads into the ledger's daily Merkle proof and the receipts.

**D7 · medium: authorize replay ignores the code, the amount and the hold's expiry.**
`redeem.go:180-185` and `settle.go:111-135` return the hold that already exists for `(merchant, order_ref)` without comparing the presented code or amount, and without checking `expires_at`.
_Scenario:_ the till authorizes order O-17 with voucher A and the call times out. The cashier scans voucher B for O-17 with a new idempotency key. The response is A's hold; `AlreadyExisted` is not in the HTTP body, so the till cannot tell. The capture then charges A.
_Fix:_ compare the code hash and amount, answer `duplicate_order` on a mismatch, and include the voucher reference in the response.

**D8 · medium: a refund can be applied twice through a stuck idempotency key.**
`internal/idempotency/claim.go:33` records completion using `r.Context()`. `db/query/idempotency.sql:9` never reclaims expired or stale rows (the TS store does, `packages/idempotency/src/postgres-store.ts:55-56`). The refund body has no business reference (`routes_release.go` `refundBody`).
_Scenario:_ a IDR 50,000 voucher has had 30,000 captured, leaving 20,000. A refund of 15,000 with key K1 commits, but the client disconnects, so the completion write fails and K1 stays `in_progress` forever. The merchant retries with K2 and a second refund lands. Total refunds are 30,000, which does not exceed the capture, so the trigger allows it, and the remaining value reaches 50,000. The customer gains 15,000.
_Fix:_ use `context.WithoutCancel`, reclaim stale rows, and add a unique `(capture_id, refund_ref)`.

**D9 · medium: the idempotency key is not signed, and there is no nonce.**
`signing.go:156-170` builds the MAC from the timestamp, key id, method, path and body digest only.
_Scenario:_ a signed refund captured from a proxy log is replayed within ±5 minutes with a fresh `Idempotency-Key`, and a second refund is applied.
_Fix:_ sign the key, and remember `(key_id, mac)` for the length of the window.

**D10 · medium: Australia is refused, and the refusal is logged as the wrong outcome.**
`redeem.go:241-244` refuses any currency except IDR and records the outcome as `wrong_merchant`. That outcome counts toward the throttle.
_Scenario:_ snap-app's AU store authorizes AUD 20.00. It is always refused, and after 20 tries the merchant is throttled.

**D11 · medium: solvency coverage overstates health after a burn.**
`BurnPoints` (`services/ledger/internal/ledger/chart.go:186-191`) moves user points into equity (`plat_points_redeemed`). `Coverage` (`solvency.go:83-110`) counts user points only.
_Scenario:_ 1,000,000 points are burned for vouchers carrying S = IDR 6,000,000 that are not yet redeemed. The reserve does not change and the liability falls, so the ratio rises while the platform still owes the 6,000,000.
_Fix:_ add voucher-liability and merchant-payable accounts per currency, and include them in coverage.

**D12 · medium: a batch is not reconciled with its listing.**
`issue.go:223-236` copies the batch's face value, policy and expiry. `GetListingTerms` (`issue.sql:184-189`) reads only merchant, title and location. Nothing checks the currency, `supplier_business_id` against the listing's `merchant_id`, the approver's role, or stock against `stock_remaining`.
_Scenario:_ a batch for listing L (face 50,000) is requested with face 500,000 and currency AUD. Any second UUID can approve it, and minting produces vouchers worth 10× what the store sells them for.
_Fix:_ derive the batch terms from the listing, and put Cerbos behind approval.

**D13 · medium: the throttle keeps itself running.**
`redeem.go:160, 171-173` records `killed` and `throttled` attempts, and `redeem.sql:132-134` counts every non-authorized outcome, including `policy_refused`.
_Scenario:_ a till auto-retries every 10 seconds, so the failure count never drops below 20 and the merchant is locked out indefinitely. Twenty honest minimum-spend refusals during a lunch rush also throttle a legitimate till.

**D14 · low: retryable conflicts return 500.**
`ErrStaleVersion` and the deferred refund-trigger violation are not mapped (`httpmap.go:103-106, 121-124, 149-152`). A refund racing an authorize produces an `internal_error` 500 where a retryable 409 is the right answer.

**D15 · low: a stale hold pins the voucher as held.**
The sweeper expires the authorization but leaves the voucher `held` (`release.go:170-179`). `ListExpirableVouchers` selects `state='active'` only (`issue.sql:206`), so a held voucher is never expired.

**D16 · high (web): the mock merchant auth can be forged, and every code reaches the browser.**
`device-session-cookie.ts:49-55, 81-86, 103-105` store the device binding as unsigned base64url JSON, and "unlocked" is a cookie with the value `"1"` and no `secure` flag. `merchant-data.ts:117-120` sends every voucher, from every merchant and with its code, into a `"use client"` component (`merchant-redemption-screen.tsx:1, 83`). `/merchant/devices` has no unlock gate (`devices/page.tsx:149-152`). `revokeDeviceAction` is unauthenticated (`provisioning-actions.ts:168-180`).
_Scenario:_ forge the two cookies and you hold any merchant's counter. The RSC payload then contains the whole voucher float.
_Fix:_ replace all of this; do not wire it up as it stands.

**D17 · low (web): the manual code entry does not normalise input.**
`merchant-redemption-screen.tsx:115-119` does only `trim().toUpperCase()`. It does not strip hyphens or apply Crockford folding (`code.go:98-115`). A code typed as displayed, `XXXX-XXXX-…`, does not match.

## 4. What the board gets wrong here

- YT-0140 ticks "tamper detection … covering both edit and delete" and cites `TestTruncatingTheChainIsDetected`, which asserts the opposite for deletion of the latest events (D6).
- YT-0153 ticks the kill switch "covering all three scopes". Batch scope is dead code (D4).
- YT-0150 ("idempotency not wired") and YT-0152 ("not wired into the HTTP path") are **stale in the other direction**: both were wired in commit 4cd4471 (`main.go:112-118`).
- YT-0594 correctly records that issuance is unrouted.

## 5. Keep / cut

**Keep:** `internal/code`; `internal/keyring`; the redemption schema constraints; `merchantauth` signing (after adding the idempotency key to the MAC); the "one refusal" mapping in `httpmap.go`; the YT-0571 merchant predicates in the queries; the lifecycle table (once enforced); the chain's canonical encoding; and the CI rule that nothing may skip (`integration.yml:315-323`).

**Cut or defer:** the resale marketplace (YT-0562); replacement-voucher refunds (removed by P-1); Shopify, WooCommerce and the hosted widget; offline Ed25519 queueing until the online counter works; the FNV rotating QR; the mock device cookie and PIN provisioning; the hand-rolled `merchant-copy.ts` dictionary (move it to next-intl, en-AU default); and async minting with signed manifests.

## 6. Recommended work, in order

1. **Unbreak (S).** YT-0513 part 2 for services/voucher (D1). Compose keygen for `merchant_hmac` plus a container boot smoke test (D2). Currency compared per voucher (D10).
2. **Harden the network (M).** Enforce lifecycle in `Move` plus a DB trigger (D3). Kill switch in capture and batch scope, plus an admin CLI (D4). Idempotency on a context that cannot be cancelled, stale-row reclaim, a signed key and `refund_ref` (D8, D9). Replay compares code and amount (D7). `order_total_minor` for minimum spend (D5). Throttle counts probes only (D13). Map retryable errors to 409 (D14). The sweeper releases the voucher (D15).
3. **Internal voucher API (M).** Service-authenticated routes for apps/api: request and approve batch (with Cerbos and terms derived from the listing, D12); `allocate-next(listing, user, saga_id)` using `FOR UPDATE SKIP LOCKED`, idempotent per saga; activate; reveal with an owner check; the wallet list.
4. **Burn saga (L).** A server-side price quote and lock → reserve stock → ledger `BurnPoints` (idempotent per saga id) → allocate and activate → confirm, with compensation (void the allocated voucher, reverse the debit). Replace `attemptBurn` in the browser.
5. **Ledger bookkeeping (L).** Voucher-liability and merchant-payable accounts; posting rules for burn, capture accrual of S and breakage; coverage that includes voucher liability (D11). **Decide S on partial capture and on forfeit** (the docs do not say).
6. **Clearing (XL).** Accrual from capture events → weekly netting per partner and region → an immutable statement → a simulated payout driver (Helios posture).
7. **Real counter (L).** Server-side device credential and `device_id` on `authorization`. The BFF calls the voucher service with a platform credential that asserts merchant and device. Drop the client-side catalogue (D16, D17).
8. **snap-app integration (M).** A CLI to issue, rotate and revoke credentials; a TS signing SDK; a simulated merchant for end-to-end tests.
9. **Expiry job plus chain anchoring (M).** Version equals sequence, replayed balances, heads anchored to the daily proof, and an export scoped per merchant (D6).
10. **Transfer (void-and-remint, one hop), after counsel (L).** Also ask counsel about minimum expiry for AU gift vouchers. The docs are silent on it, and today expiry is fixed per batch at mint time.
