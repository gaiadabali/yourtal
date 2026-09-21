# Phase 1 · Store, vouchers, merchant redemption, clearing

The spending half of the loop: points buy things, and those things work at the merchant.

---

## Store

### YT-0130 · Unified catalogue
`doing` · P1 · store · 5d · dep: YT-0049

- [ ] One catalogue holding vouchers and digital goods from every supplier — **still unmet, but not for the reason this line used to give.** ~~There is no catalogue service or CRUD yet~~ is **false**, corrected 2026-09-21. **Reported by `yourtal-b6` with its command, re-run here rather than accepted:** `find apps/api/src/modules/store -type f` → **45** files (b6 counted 44 twenty minutes earlier — the board moves faster than a count of it). `store-catalogue.controller.ts` (`@Get`, `@Get :listingId`) and `store-listing.controller.ts` (`@Post`, `@Get`, `@Patch :id`, `@Post :id/settlement-value`, `@Get :id/price-revisions`, `@Post :id/pause|resume|retire`) both exist, with nine use-cases and Drizzle repositories. **What is genuinely unmet is the other half of the sentence**: there is no digital-goods supplier (YT-0135, `todo`), so the catalogue is not yet holding goods "from every supplier". Not ticked — a criterion can be half false and still unmet
- [x] `points_price = (S / B) × demand_multiplier` is implemented in `services/ledger/internal/pricing`, **integers throughout via `math/big`** — a float price is 1,999.9999999 on one machine and 2,000 on another. **docs/09 §4.1's worked example is a test and lands exactly on 2,000 and 5,000 points**
- [x] **A supplier can never set a points price directly — now true by GRANT rather than by convention.** The backing rate `B` lives in the `ledger` schema, which `yourtal_app` cannot read at all, so the store service physically cannot compute a price even on purpose
- [x] `B < P_issue` is a CHECK constraint, so the spread docs/09 §4.1 calls the margin cannot be set away. Rounding is **always up**: rounding down sells below backing in the same direction every time, so the shortfall accumulates rather than averaging out
- [x] Coverage ratio (docs/09 §5) measured from ledger projections, never a stored total. **An unfunded faucet is shown to drive it down** — the test funds a purchase, grants against it, then grants marketing points with no cash behind them and watches the ratio fall
- [ ] The demand multiplier is bounded 0.8–1.25 and **launches at 1.0**; nothing moves it yet

### YT-0131 · Supplier listing management
`doing` · P1 · store · 4d · dep: YT-0130

- ✏️ **`todo` 0/3 was wrong; audited 2026-09-21 by `yourtal-b6`, each criterion re-verified here.** Substantially built. One criterion ticks, two do not — and both refusals are for better reasons than "not done yet"
- [ ] Create, edit, pause and retire a listing; quantity and per-user limits — **almost, and the gap is a control that exists only as a field.** All four verbs are routes on `store-listing.controller.ts`; quantity is `stockTotal`/`stockRemaining` (`listing.ts:51-52`) with refinements at `:68` and `:77`. **But `perUserLimit` is stored and never read.** **Reported by `yourtal-b6` with its command, re-run here rather than accepted:** an unfiltered sweep across `apps`, `packages`, `services` returns **36** hits and **every one is a schema, DTO, column, repository write or generated model** — `drizzle-listing.repository.ts:114,151`, `listing.repository.ts:31,51`, `store-listing.controller.ts:65`, `model_listing.go:44`, `listing.ts:66`. **No decision anywhere consumes it.** This is the `IDEMPOTENCY_TABLE_DDL` shape again: a limit that is persisted, transported and typed, and enforced by nothing. Enforcement belongs to YT-0133, so it is correctly deferred — but **this criterion as worded claims it**, so it cannot tick
- [x] Transferability and partial-redemption policy set per batch at issuance — **MET.** **Reported by `yourtal-b6` with its command, re-run here rather than accepted:** `services/voucher/internal/issue/issue.go` takes `req.PartialPolicy` and `req.Transferable` onto the batch (~`:105-110`), and carries `batch.PartialRedemptionPolicy` and `batch.Transferable` onto each voucher (~`:228-233`). Per batch, at issuance, exactly as worded
- [ ] Changing `S` reprices the listing and is audit-logged — **audit-logged yes, reprices no, and the refusal is correct.** **Reported by `yourtal-b6` with its command, re-run here rather than accepted:** `apply-settlement-value-change.ts:69` writes `newPriceInPoints: null` and leaves `priceInPoints` untouched; `listing-price-revision.table.ts:8` states why — *"this module cannot compute a real points price"*. That follows from this ticket's parent: YT-0130's ticked criterion that `B` lives in the `ledger` schema which `yourtal_app` **cannot read at all**, so the store physically cannot price on purpose. **Blocked by a dependency, not by a defect** — and it is the same `B` that YT-0049 → YT-0048 → YT-0012 gates
- ⚠️ **The structural finding, which matters more than the ticks** (`yourtal-b6`): the `store` epic carries **92d**, its P1 chain is 27d of that, and repricing — so the whole catalogue-pricing story — **bottoms out in YT-0012, a `legal` ticket at `todo` 0/4.** A legal risk-acceptance is the gate on a 92-day epic. Raised to the founder

### YT-0132 · Store browse and search
`doing` · P1 · store · 5d · dep: YT-0130, YT-0055, YT-0519

- ✏️ **Audited 2026-09-21 by `yourtal-b6` as a correction rather than an implementation — the query half needed no new work.** `dep:` gained **YT-0519**, which `yourtal-c8` asked for twice and which was still missing: criterion 3 is gated on the BFF seam YT-0519 failed verification on
- [x] Filter by category, merchant, price band and location; Postgres full-text search — **all five, AND-ed under an `active`-only floor**, in `persistence/browse-listings-conditions.ts`: `category`, `merchantId`, `minPoints`/`maxPoints`, `district` (an `exists` join through `listing_location` → `merchant_location`), and FTS as a **parameterised** `sql` template rather than string-built. **Verified here**: the GIN index `listings_search_idx` at `20260920040000_store_listing_management.sql:32-33` carries an expression identical to the query's, so it is usable rather than merely present. `simple` rather than a language config is deliberate and documented in both places — the catalogue mixes Indonesian and English, and **no stemming is honest about doing linguistic analysis for neither, rather than silently for one**
- [ ] Price and terms visible before the user commits any points — **the data half is met; the visibility half is unproven, so this stays open.** `store-catalogue.controller.ts` serves browse and offer detail as `@PublicRoute` reads returning `PublicListing` (price, face value, transferability, partial-redemption policy, minimum spend, expiry, stock, per-user limit, locations), and **no burn path exists in this module at all**, so nothing can take points before this is read. But "visible" is a claim about a surface, and the surface is `yourtal-c8`'s. `yourtal-b6` recommended ticking it with the limit noted; **declined for consistency** with YT-0519, where *"Phase U surfaces read it through `apps/api`"* was ticked on a served shape that nothing rendered. Closed by a rendered page, not by an endpoint
- [ ] Server-rendered for SEO; see the SEO task set

### YT-0133 · Redemption: burn points for a voucher
`todo` · P1 · store · 5d · dep: YT-0130, YT-0042, YT-0593, YT-0594

- [ ] Reserve stock → debit points → issue voucher → confirm, as a compensating saga
- [ ] Any failure releases the reservation and reverses the debit; every step idempotent
- ⏭️ **Price lock belongs to YT-0049, not here.** This box read *"price locked for 15 minutes from the moment it is shown"*, which is **verbatim YT-0049's second criterion** — the pricing engine owns price semantics, and a second lock inside the redemption saga is two implementations of one control, which is how they drift apart. Found by `yourtal-b6` while checking `economy`'s scope before starting `store`'s; neither ticket referenced the other
- ⚠️ **This ticket was offered as ready work and is not buildable, which is why its `dep:` grew.** Two of its four saga steps have no callable interface: `POST /v1/transfers` is a 501 (**YT-0593**) and voucher issuance is routed nowhere (**YT-0594**). Nothing decrements `stockRemaining` either. Its old deps — YT-0130 `doing` and YT-0042 `review` — both counted as satisfied under the board's former readiness rule, so it showed as startable; `yourtal-b6` lost an afternoon to that before reaching the 501. The rule is fixed and the missing work is now ticketed, so the board and the code agree

### YT-0134 · Holdback and trust gate on redemption
`todo` · P1 · store · 3d · dep: YT-0133, YT-0054

- [ ] 72 h holdback for tier-0 accounts, decaying with trust
- [ ] Redemptions above a value threshold enter manual review
- [ ] The user is told why, in plain language, with a time

### YT-0135 · Digital goods supply integration
`todo` · P1 · store · 5d · dep: YT-0133

- [ ] Pulsa/data top-ups and e-vouchers via one aggregator; instant fulfilment
- [ ] Supplier outage degrades gracefully — the listing delists, no points are taken
- [ ] Reconciled daily against the supplier's statement

## Voucher

### YT-0140 · Voucher issuance and code custody
`review` · P1 · value · 5d · dep: YT-0533, YT-0041

**`services/voucher` exists as its own Go module — 67 tests, run against real Postgres wherever the claim is about the database.**

- **Re-parented 2026-09-20: `YT-0026` → `YT-0533`.** This needed *a* key-management capability, not a *GCP* one — and YT-0026 was deferred by the Helios decision, so this chain was waiting on a task nobody intends to do. Through YT-0140 that stale edge was transitively blocking the whole voucher and merchant chain: **31 tasks queued behind a founder signup we had already decided against.** Same mistake as the original cloud gating, one layer deeper in the graph
- [x] 17 symbols of Crockford Base32 — 16 payload (80 bits from `crypto/rand`) plus a check symbol. No prefix, no counter. Five bits taken as `b & 0x1f`, so there is **no modulo bias**; `% 32` on a non-power-of-two alphabet needs rejection sampling, and missing that quietly halves an entropy estimate
- [x] **Every single-symbol typo and every adjacent transposition is caught, exhaustively rather than sampled.** The check symbol is mod 37 — prime, which is what makes that true. This matters because a mistyped code and an enumeration probe are otherwise indistinguishable to the alerting, and every fat thumb at a till would look like an attack
- [x] `voucher.code_custody` holds SHA-256 for lookup plus an envelope-encrypted copy for display. The **plaintext column was dropped**, not encrypted in place — `WHERE code = $1` against ciphertext needs deterministic encryption, which is a dictionary away from being no encryption. `yourtal_app` has **no grant on that table at all**, proved by a test that watches the refusal
- [x] Per-voucher hash-chained event log, **and the tamper detection is driven rather than claimed**: editing a stored event and deleting one both break verification, against the real table, with the sabotage confirmed to have touched exactly one row first
- ⚠️ **"KMS" is not a KMS.** Custody is `internal/keyring` on Helios (YT-0533): AES-256-GCM, per-record data keys, purpose bound into the AEAD so a relabelled ciphertext does not decrypt, and master keys refused if they live inside a git working tree. **Single-host key custody is weaker than a KMS and must not be carried into production**

- ⚠️ **Title and criteria disagree about scope, and the title is the one people read.** This ticket is called *"Voucher issuance and code custody"*, and **not one of its criteria mentions a route** — every bar describes the Go function. The work is defensibly complete as written and the criteria are unusually rigorous; what overpromises is the word in the title. Raised by `yourtal-b6` while tracing why YT-0133 was unbuildable, escalated by `yourtal-a4`, and confirmed here against the source
- ℹ️ **The missing HTTP surface is now ticketed as **YT-0594****, so it is work in the graph rather than an implication nobody owns. **YT-0140 is not failed for this** — a ticket is measured against its criteria, not its title, and re-scoping it retrospectively would move the bar under work that already met it
- ⛔ **It should not reach `done` while the title still claims an API that does not exist.** `done` is the board's strongest public statement and this one would be read as *"the API is finished and verified"*. The fix is one of: retitle to what the criteria actually cover, or add a criterion for the route and return this to `doing`. **That is the epic owner's call, not the verifier's** — flagged here rather than decided. This is the third instance in one day of *proved in tests, absent from the running system*, after YT-0519 and the ledger having no HTTP caller

### YT-0141 · Bulk issuance with two-person approval
`doing` · P1 · value · 4d · dep: YT-0140, YT-0038

- [ ] Request → approval by a second person → **async** mint → **signed** manifest — two halves outstanding. **The second person is real and structural**: approval is `UPDATE ... WHERE requested_by <> $approver`, so a self-approval matches no row rather than being caught by a check somebody remembered to write. Minting is currently **synchronous**, and the manifest is a SHA-256 over the sorted (voucher id, code hash) pairs — a commitment, **not a signature**. Signing needs the Ed25519 key that arrives with YT-0143
- [x] Every batch carries a funding record: `NOT NULL` with a non-empty CHECK, so a batch that creates liability cannot exist without naming what funds it
- [ ] Alerts on high-value voids and duplicate issuance — **duplicate issuance is prevented rather than alerted on**: `approved -> minting` matches no row for a second caller, so a double mint is unrepresentable. The alerting itself does not exist

### YT-0142 · Voucher lifecycle state machine
`doing` · P1 · value · 4d · dep: YT-0140

- ✅ **RESOLVED by founder decision P-1 (2026-09-20): there are no refunds.** The conflict is removed rather than arbitrated — `redeemed` stays terminal, nothing is ever minted inside a refund, and the named refusal on full consumption is now **permanent behaviour rather than a placeholder**. An unwanted voucher exits by resale, charity, gift, or expiry
- ⛔ **FOUNDER DECISION NEEDED: a refund after full redemption.** YT-0142 says `redeemed` is terminal; `docs/09` §8.1 says a refund _"restores value post-capture"_. **Both cannot hold for a voucher that was fully consumed and then refunded.** Either `redeemed` is not terminal, or the refund **mints a replacement voucher** linked to the original
- Built with `redeemed` terminal and replacement as the intended answer, because **reviving a spent voucher means a state write can un-spend money**. A partially-captured balance-carrying voucher never reaches `redeemed`, so this only bites on full consumption
- [ ] ⚠️ **The consequence needs confirming, because it is not an implementation detail.** A replacement carries a **new code and a new expiry**, which (a) **resets a liability clock** we account for, (b) gives the merchant a **second code to reconcile against one original sale**, and (c) opens a **redeem-then-refund path** that risk should look at before it exists rather than after
- Until confirmed: the partial case is implemented and **the full case refuses with a named error** rather than quietly inventing a mint inside a refund. A refusal someone has to ask about beats a silent behaviour nobody chose
- [x] All seven states — in Go, in TypeScript (`voucher-lifecycle.ts`, following the campaign precedent) and as a CHECK constraint. **Every pair is tested against a hand-written expectation rather than against the transition table itself**, because a test generated from the table asserts only that the table equals itself
- [x] `redeemed` and `voided` are both terminal; transitions are `UPDATE ... WHERE version = $n`, so a writer working from a stale read matches no row instead of overwriting a transition it never saw
- [x] `voucherSchema.status` is **derived**, the stored column dropped, and both exemptions recorded in `schema-drift.test.ts`. A voucher with no public form **404s identically to a nonexistent id**: the public enum cannot represent `minted`, `allocated` or `held`, so the conversion drops them rather than validating and throwing
- [ ] Expiry job is idempotent and reversible within a grace window — `ExpiryIsReversible` exists and is tested at both boundaries, but **there is no voucher expiry job yet**. The hold sweeper is a different thing and does not expire vouchers

### YT-0143 · Rotating signed QR for in-store redemption
`todo` · P1 · value · 4d · dep: YT-0142

- [ ] Ed25519 signature over voucher, user, nonce and expiry; CBOR-encoded
- [ ] 30–60 s validity; screenshots are useless
- [ ] Renders offline from the service worker with no network

## Merchant redemption

### YT-0150 · Redemption API: authorize
`doing` · P1 · merchant · 5d · dep: YT-0142, YT-0039

- [x] Code, amount and order reference are required fields, not options. **No bare balance endpoint**, and the refusals are deliberately indistinguishable: unknown code, wrong merchant and insufficient value all return one error while the specific outcome goes to `voucher.redemption_attempt` for alerting. Asserted by checking two different refusals produce the *same message* — otherwise binary search on the amount reconstructs the balance
- [x] 15-minute TTL, and concurrency settled by `UNIQUE (voucher_id) WHERE state = 'held'`. **A partial index, because a service-level check cannot settle two tills scanning the same code in the same instant**
- [ ] Idempotency key mandatory — **not done.** A retried authorize for the same `(merchant, order_ref)` returns the existing hold, which covers the common retry, but the shared `platform.idempotency` interceptor (YT-0039) is not wired in
- ⚠️ **The HTTP routes return 501 on purpose.** The implementation is complete and tested; what is missing is merchant signature verification, and an authorize endpoint anyone can call is exactly the enumeration surface `docs/09` §10 exists to remove

### YT-0151 · Redemption API: capture, void, refund
`doing` · P1 · merchant · 5d · dep: YT-0150

- [x] Enforced in the **database**, not server-side: the authorized amount is carried on the capture row and pinned by a **composite foreign key**, so a caller cannot inflate it to justify a larger capture. Both the over-capture and the lie-about-the-authorization are driven into failure
- [x] Holds expire automatically — with one caveat now written into the code and tested rather than glossed: the expiry filter makes **capture** of a stale hold impossible, but the one-live-hold index cannot reference `now()`, so a stale hold still blocks a **new** authorize until the sweeper runs. "Cannot lock a voucher forever" bottoms out at the sweep interval, and **if the sweeper dies the voucher stays locked** — a real dependency with no alarm on it yet
- [x] After settlement only refundable, never voidable — structural rather than checked: `Void` takes an authorization id, and a captured authorization has no live hold, so there is no code path from a receipt to a void
- [ ] ⛔ **Refunding a fully redeemed voucher refuses with a named error**, pending the founder decision recorded on YT-0142. The partial case works and restores value

### YT-0152 · Merchant credentials and request signing
`doing` · P1 · merchant · 4d · dep: YT-0150, YT-0533

- **Re-parented 2026-09-20: `YT-0026` → `YT-0533`.** Per-merchant API keys need key custody and rotation, which YT-0533 provides on Helios; the GCP keyring is deferred
- [x] HMAC-SHA256 over method, path, timestamp, key id and a body digest, `hmac.Equal` throughout. **Each covered field is tested by tampering with it alone** — change the body and the amount moves under a valid signature; change the path and a capture replays as a refund; change the key id and a rotation becomes "try both keys", which doubles an attacker's chances rather than halving them
- [x] Replay window is ±5 minutes and **symmetric**: a request from the future is as suspicious as an old one, or an attacker with a forged clock mints long-lived signatures. Re-dating a captured request invalidates it, because the timestamp is itself signed
- [ ] **Not yet wired into the HTTP path** — which is why YT-0150's routes return 501
- [ ] Scheduled key rotation with overlap; revocation immediate — the queries and the credential states exist; there is no scheduler
- [ ] Signed webhooks in both directions — not started

### YT-0153 · Enumeration defence and anomaly detection
`doing` · P1 · merchant · 4d · dep: YT-0152

- [x] Auto-throttle at 20 failed lookups in 5 minutes, counted from **rows** rather than a counter — the same reasoning the Reward Engine counts velocity from its grant log: an evicted cache key becomes free attempts for whoever notices first. Driven to the threshold and over it
- [ ] The **alert** half does not exist. Throttling without alerting means an enumeration attempt is slowed and nobody is told
- [ ] Redemption rate, average value and time-of-day profile — not started
- [x] Kill switch in one table covering all three scopes, because in an incident the question is "stop this now" and nobody should have to remember which of three tools covers the case in front of them. **Global and per-merchant are tested including the lift** — a kill switch nobody can turn off is one nobody dares turn on. Per-batch scope exists and is not yet exercised
- [x] No code, and no hash of one, is stored in the attempt log: it would be a second custody surface with none of the custody, and the pattern being detected does not need to know what was guessed

### YT-0154 · Manual merchant portal redemption
`todo` · P1 · merchant · 4d · dep: YT-0142, YT-0056

- [ ] Staff type a code, get a confirmation, apply a manual discount — zero integration
- [ ] Mobile-first, huge targets, works on a cheap phone in a busy shop
- [ ] This is the launch path and must ship before the API is offered to anyone

### YT-0155 · Partial redemption policy
`doing` · P1 · merchant · 3d · dep: YT-0151

- [x] All three, selected per batch, applied in **one function** so the merchant portal and the API cannot diverge. Each is driven end to end: IDR 50,000 on a IDR 30,000 order leaves IDR 20,000 and stays active; a single-use voucher is consumed whatever is spent; a minimum-spend voucher refuses below its threshold
- [x] The minimum-spend refusal is **the one refusal that names its number**, because the customer already knows what is in their basket and hiding it makes the voucher unusable rather than secure. Every other refusal stays opaque
- [ ] Policy displayed prominently before the user spends points — `apps/web`, not started here
- [ ] Remaining balance visible to the user immediately after capture — the capture result carries it; the surface does not exist yet

### YT-0156 · Merchant portal: reporting and reconciliation
`todo` · P1 · merchant · 4d · dep: YT-0154, YT-0160

- [ ] Redemptions honoured, amounts owed, settlement statements, downloadable
- [ ] Every figure drills through to the underlying voucher events

## Clearing

### YT-0160 · Clearing accrual
`todo` · P1 · value · 5d · dep: YT-0046, YT-0151

- [ ] Per-partner obligations accrued both directions: points issued and value honoured
- [ ] Derived entirely from ledger events, never hand-entered

### YT-0161 · Weekly netting and statements
`todo` · P1 · value · 4d · dep: YT-0160

- [ ] One net figure per partner per cycle, one direction
- [ ] Statement is immutable, signed and reproducible from ledger entries
- [ ] Dispute window before any payout moves

### YT-0162 · Payout execution
`todo` · P1 · value · 4d · dep: YT-0161

- [ ] Xendit disbursement for Indonesia; idempotent, reconciled, retried safely
- [ ] Float never funds operating expenses; segregation asserted daily

### YT-0562 · DECIDE: what is a resale bid denominated in?
`blocked` · P2 · legal · 2d · dep: —

- **Blocks all resale work and must be answered before any of it is built.** Founder decision P-2 adds a bidding marketplace for unwanted vouchers. The mechanism is sound; the denomination decides which regulatory regime it lands in, and the two answers are not variations of one feature
- [ ] ⚠️ **Bids in points reverse the one-way valve.** `docs/01` §5 states cash and points move one way and a voucher never becomes points again. Resale for points makes it do exactly that, and **creates a market price for points**, which is a published rate in all but name — attacking `docs/24` **ID-1**, whose four legs are: cannot buy, cannot transfer, expire, no published fixed rate. `docs/24` also records that the plan's entire legal exposure is **concentrated in ID-1 and ID-2**
- [ ] ⚠️ **Bids in cash are very likely money transmission** in both markets, and end the argument that this is a loyalty scheme
- [ ] ⚠️ **Either way it contradicts the control `docs/09` §7 was written to provide**: _"One hop only … killing the chain that would turn vouchers into a circulating currency"_ and _"Do not let 'users want to gift' quietly become 'users can trade.'"_ That sentence was written before this decision and describes it exactly
- [ ] **Alternative that delivers the same user outcome:** the **platform buys the voucher back** at a formula price in points. No user-to-user trade, no bidding, no circulating currency, price stays platform-set. The unhappy user still gets an exit — from us rather than from each other — and every leg of ID-1 survives
- [ ] Whichever is chosen, the **arbitrage against `points_price = (S / B) × multiplier` must be modelled** before launch: a secondary price below store price makes the store the worse deal and drains it

### YT-0563 · Charity donation of a voucher
`todo` · P2 · value · 4d · dep: YT-0142

- **Founder decision P-2.** The exit with the least regulatory weight and real brand value, so worth building ahead of resale
- [ ] Donation is a **void-and-remint to the charity's account**, reusing the one-hop transfer machinery rather than a second path
- [ ] ⚠️ **A donated voucher is spent, not extinguished** — the charity redeems it at the merchant, so the merchant's obligation and the clearing accrual are unchanged. Treating it as a write-off would silently under-state what we owe partners
- [ ] No tax receipt is issued and nothing implies one, unless someone qualified says otherwise — that is a regulated representation in both markets
- [ ] Charity recipients are a **verified allow-list**, not free entry, or the donation path becomes an unverified-recipient transfer with a nicer name

### YT-0571 · `Capture` and `Void` resolve an authorization by id alone
`todo` · P1 · merchant · 2d · dep: YT-0151

- **Found by `yourtal-22` 2026-09-20 while exposing the redemption API; verified here against `main`.** `db/query/redeem.sql` resolves with `WHERE id = $1 AND state = 'held' AND expires_at > now()` — **no `merchant_id` predicate**. Proved by disabling the new HTTP check: a stranger's signed capture succeeded and returned a receipt
- **The query is correct for the invariant its own tests assert** — an authorization id is only ever handed back to the merchant that placed the hold. That invariant holds in the domain layer and **stops holding the moment the id is client-supplied over HTTP**, which is exactly what exposing the endpoint did
- ⚠️ Fixed at the boundary (`internal/redeem/ownership.go`), refusing a cross-merchant guess with the **same `no_live_authorization` message** a genuinely missing id gets, per YT-0153's enumeration discipline. **The domain queries are still unscoped.** Safe only because there is one caller that checks — that is a convention, not a constraint, and it is the shape that bites when a second caller appears
- [ ] `merchant_id` becomes a predicate in the **query** for **both** `ResolveAuthorization` and `GetCaptureByReceipt`, so the guarantee survives a caller that forgets. **Refund is not a gap to investigate — `yourtal-22` reports `captureForReceipt` in `internal/redeem/ownership.go` already refuses a cross-merchant receipt with `ErrNotFound`** (reported, not verified here: that file is on an unpushed branch). It has the protection **in the same shape**, which makes it a second instance of this ticket rather than a separate hunt. Two queries to fix, not one to fix and one to find
- [ ] Sabotage-prove it at the domain layer, not only over HTTP: call `Capture` directly with another merchant's authorization id and confirm refusal
- [ ] The refusal stays **indistinguishable** from a missing id — no timing or message difference that lets a merchant enumerate another's holds
- [ ] **Audit the rest, from a list rather than a hunt.** Queries on `main` resolving a client-supplied id with **no merchant or owner predicate** — `redeem.sql`: `GetAuthorization`, `ResolveAuthorization`, `GetCapture`, `GetCaptureByReceipt`, `SumRefunds`. `issue.sql`: `GetBatch`, `GetVoucher`, `GetCodeCustody`, `TransitionVoucher`, `ListEvents`, `LatestEvent`, `GetListingTerms`. Each must **either gain a predicate or carry a comment saying why it needs none** — `FindVoucherByCodeHash` plausibly needs none, since possessing the code *is* the credential. A silent absence and a considered absence must stop looking identical
- ⚠️ **The tell that this is convention rather than constraint: the scoping is present exactly where someone thought about it.** `GetAuthorizationForOrder` *is* scoped (`WHERE merchant_id = $1 AND merchant_order_ref = $2`) and `ApproveBatch` enforces separation of duties (`requested_by <> $2`). The same file, the same author, the same week — scoped where the author had the attacker in mind and unscoped where they had the caller in mind. **Neither agent swept for this; capture and void were found because someone was wiring them, not because anyone went looking**
- ⚠️ **The transferable sentence, and the one to keep: a boundary check protects the boundary; a `WHERE` clause protects the data.**

### YT-0572 · The currency refusal leaks which check failed
`todo` · P1 · merchant · 4h · dep: YT-0151

- `internal/redeem/redeem.go:243` wraps detail into the error — `"%w: this voucher is denominated in IDR and the request is in %s"` — while **every other `ErrRefused` branch returns the bare sentinel**
- ⚠️ Currency is checked **after** merchant, state, expiry and value all pass. So the message text distinguishes _"wrong merchant"_ from _"right merchant, wrong currency"_ to anything that echoes `err.Error()` verbatim — an oracle that confirms a guessed code belongs to you
- ⚠️ `yourtal-22`'s agent closed it at the boundary it owned (`writeAuthorizeError` uses `ErrRefused.Error()`, never `err.Error()`). **So the domain now depends on the HTTP layer papering over it, and that dependency is invisible.** Same shape as YT-0571: the guarantee lives in the caller rather than in the thing being called
- [ ] The branch returns the bare sentinel like its siblings; the detail moves to a log field, where it is useful and not returned
- [ ] A test asserts **every** `ErrRefused` branch produces an identical caller-visible string — a table over the branches, so a new one cannot quietly differ
- [ ] Grep for other wrapped-detail refusals across `services/voucher`; this is unlikely to be the only one

### YT-0573 · Nothing ever marks a voucher expired
`todo` · P1 · merchant · 2d · dep: YT-0142

- ⚠️ **YT-0142 blurs two different jobs.** `sweepHolds` sweeps **authorizations** — abandoned holds. It is not a voucher expiry job and never was
- **Verified against `main`**: `lifecycle.Expired` is declared in `lifecycle.go` and appears in `States` and the transition map, and the only file that otherwise references it is `lifecycle_test.go`. `chain.TypeExpired` exists as an event type that **nothing emits**. No production path sets a voucher's `state` to `'expired'`
- **Safety does not depend on it**: `check()` compares `ExpiresAt` live rather than trusting a sweeper, so an expired voucher cannot be spent. **Correctness of the table does**: a voucher long past expiry still reports `state = 'active'` to anything reading it directly — the merchant portal and reconciliation both see a stale truth
- ⛔ **This blocks P-2 (resale), and it is the worst consequence rather than a footnote.** Founder decision P-2: a listing is valid **while the expiry date is still active**, and an expired voucher means the listing is cancelled. That rule is expressed against a `state` column **nothing ever updates**. A bidding marketplace reading `state` would keep expired vouchers **listed and sellable** — trading instruments that have already lapsed, to a buyer paying for them. **That is a dispute, not a bug**, and it arrives in the market this platform is least able to absorb it in. Stated as its own line because **resale will be built by someone who did not read this ticket**, and because the reading is one level removed from the defect: the sweeper's absence looks harmless until you know what P-2 promised. Raised with `yourtal-22`, who confirms it is worse than the reconciliation case they reported
- [ ] A job transitions `active → expired` past `expires_at`, emitting `chain.TypeExpired` so the event exists in the chain rather than only in the column
- [ ] It **reports liveness and pages when it has not run**, per YT-0566 — a job that stops running produces no errors at all
- [ ] Alert on the **age of the oldest unexpired-but-past-expiry voucher**, which measures the promise rather than the job
- [ ] A test asserts the two sweepers are distinct and that neither covers the other's case

### YT-0594 · Voucher issuance is routed nowhere
`todo` · P1 · value · 3d · dep: YT-0140, YT-0593

- ℹ️ **Filed 2026-09-21 by `yourtal-22`, from `yourtal-b6`'s finding, re-verified here.** `services/voucher/cmd/voucher/main.go:89` builds the minter — `minter := issue.New(pool, keys)` — and **its only other appearance in the file is a log line**: `logger.Info("voucher listening", "addr", addr, "minter", minter != nil)`. Searching `services/voucher/internal/httpx` for an issuance handler returns nothing
- ⚠️ **`minter != nil` is the entire consumer of the voucher issuance engine.** Unlike the ledger, there is not even a 501 here: the ledger at least mounts an honest refusal that names its blocker, so a caller learns the route exists and why it will not serve. Issuance has no route to refuse, so the same question gets a 404 and reads as "wrong URL" rather than "not built yet"
- ℹ️ Same shape as YT-0593 and the same reporting gap: **YT-0140 sits at `review`** covering code generation, custody and the event chain, and no criterion mentions a route
- [ ] Voucher issuance is reachable over HTTP, behind the same caller authentication and idempotency the ledger's write routes require
- [ ] Until it is, the endpoint **exists and refuses with a 501 naming its blocker**, matching the ledger's `notYetExposed` pattern — so an unbuilt surface is distinguishable from a wrong path
- [ ] A replayed issuance request returns the original batch rather than minting twice
- [ ] Per-batch `transferable` and `partialPolicy` survive the HTTP boundary, since YT-0131 proved them at the function boundary only

