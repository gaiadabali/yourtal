# Phase 1 · Store, vouchers, merchant redemption, clearing

The spending half of the loop: points buy things, and those things work at the merchant.

---

## Store

### YT-0130 · Unified catalogue
`doing` · P1 · store · 5d · dep: YT-0049

- [ ] One catalogue holding vouchers and digital goods from every supplier — the listing table exists from the seed; there is **no catalogue service or CRUD** yet
- [x] `points_price = (S / B) × demand_multiplier` is implemented in `services/ledger/internal/pricing`, **integers throughout via `math/big`** — a float price is 1,999.9999999 on one machine and 2,000 on another. **docs/09 §4.1's worked example is a test and lands exactly on 2,000 and 5,000 points**
- [x] **A supplier can never set a points price directly — now true by GRANT rather than by convention.** The backing rate `B` lives in the `ledger` schema, which `yourtal_app` cannot read at all, so the store service physically cannot compute a price even on purpose
- [x] `B < P_issue` is a CHECK constraint, so the spread docs/09 §4.1 calls the margin cannot be set away. Rounding is **always up**: rounding down sells below backing in the same direction every time, so the shortfall accumulates rather than averaging out
- [x] Coverage ratio (docs/09 §5) measured from ledger projections, never a stored total. **An unfunded faucet is shown to drive it down** — the test funds a purchase, grants against it, then grants marketing points with no cash behind them and watches the ratio fall
- [ ] The demand multiplier is bounded 0.8–1.25 and **launches at 1.0**; nothing moves it yet

### YT-0131 · Supplier listing management
`todo` · P1 · store · 4d · dep: YT-0130

- [ ] Create, edit, pause and retire a listing; quantity and per-user limits
- [ ] Transferability and partial-redemption policy set per batch at issuance
- [ ] Changing `S` reprices the listing and is audit-logged

### YT-0132 · Store browse and search
`todo` · P1 · store · 5d · dep: YT-0130, YT-0055

- [ ] Filter by category, merchant, price band and location; Postgres full-text search
- [ ] Price and terms visible before the user commits any points
- [ ] Server-rendered for SEO; see the SEO task set

### YT-0133 · Redemption: burn points for a voucher
`todo` · P1 · store · 5d · dep: YT-0130, YT-0042

- [ ] Reserve stock → debit points → issue voucher → confirm, as a compensating saga
- [ ] Any failure releases the reservation and reverses the debit; every step idempotent
- [ ] Price locked for 15 minutes from the moment it is shown

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
