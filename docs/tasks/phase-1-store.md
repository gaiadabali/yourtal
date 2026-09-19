# Phase 1 · Store, vouchers, merchant redemption, clearing

The spending half of the loop: points buy things, and those things work at the merchant.

---

## Store

### YT-0130 · Unified catalogue
`todo` · P1 · store · 5d · dep: YT-0049

- [ ] One catalogue holding vouchers and digital goods from every supplier
- [ ] Supplier declares settlement value `S`; the platform computes the points price
- [ ] A supplier can never set a points price directly

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
`todo` · P1 · value · 5d · dep: YT-0533, YT-0041

- **Re-parented 2026-09-20: `YT-0026` → `YT-0533`.** This needed *a* key-management capability, not a *GCP* one — and YT-0026 was deferred by the Helios decision, so this chain was waiting on a task nobody intends to do. Through YT-0140 that stale edge was transitively blocking the whole voucher and merchant chain: **31 tasks queued behind a founder signup we had already decided against.** Same mistake as the original cloud gating, one layer deeper in the graph
- [ ] ≥16-char CSPRNG codes, no prefix or counter, checksum for typo detection
- [ ] Stored hashed for lookup plus KMS envelope-encrypted for display to the owner only
- [ ] Per-voucher hash-chained event log

### YT-0141 · Bulk issuance with two-person approval
`todo` · P1 · value · 4d · dep: YT-0140, YT-0038

- [ ] Request → approval by a second person → async mint → signed manifest
- [ ] Every batch carries a funding record so the liability is always attributable
- [ ] Alerts on high-value voids and duplicate issuance

### YT-0142 · Voucher lifecycle state machine
`todo` · P1 · value · 4d · dep: YT-0140

- ✅ **RESOLVED by founder decision P-1 (2026-09-20): there are no refunds.** The conflict is removed rather than arbitrated — `redeemed` stays terminal, nothing is ever minted inside a refund, and the named refusal on full consumption is now **permanent behaviour rather than a placeholder**. An unwanted voucher exits by resale, charity, gift, or expiry
- ⛔ **FOUNDER DECISION NEEDED: a refund after full redemption.** YT-0142 says `redeemed` is terminal; `docs/09` §8.1 says a refund _"restores value post-capture"_. **Both cannot hold for a voucher that was fully consumed and then refunded.** Either `redeemed` is not terminal, or the refund **mints a replacement voucher** linked to the original
- Built with `redeemed` terminal and replacement as the intended answer, because **reviving a spent voucher means a state write can un-spend money**. A partially-captured balance-carrying voucher never reaches `redeemed`, so this only bites on full consumption
- [ ] ⚠️ **The consequence needs confirming, because it is not an implementation detail.** A replacement carries a **new code and a new expiry**, which (a) **resets a liability clock** we account for, (b) gives the merchant a **second code to reconcile against one original sale**, and (c) opens a **redeem-then-refund path** that risk should look at before it exists rather than after
- Until confirmed: the partial case is implemented and **the full case refuses with a named error** rather than quietly inventing a mint inside a refund. A refusal someone has to ask about beats a silent behaviour nobody chose
- [ ] States: minted, allocated, active, held, redeemed, expired, voided
- [ ] `redeemed` is terminal; transitions guarded by optimistic concurrency
- [ ] Expiry job is idempotent and reversible within a grace window

### YT-0143 · Rotating signed QR for in-store redemption
`todo` · P1 · value · 4d · dep: YT-0142

- [ ] Ed25519 signature over voucher, user, nonce and expiry; CBOR-encoded
- [ ] 30–60 s validity; screenshots are useless
- [ ] Renders offline from the service worker with no network

## Merchant redemption

### YT-0150 · Redemption API: authorize
`todo` · P1 · merchant · 5d · dep: YT-0142, YT-0039

- [ ] Requires code, amount and merchant order reference — there is no bare balance endpoint
- [ ] Places a hold with a 15-minute TTL; concurrent authorize on one voucher is serialised
- [ ] Idempotency key mandatory

### YT-0151 · Redemption API: capture, void, refund
`todo` · P1 · merchant · 5d · dep: YT-0150

- [ ] Capture cannot exceed the authorized amount; enforced server-side
- [ ] Holds expire automatically so an abandoned cart never locks a voucher
- [ ] After settlement a transaction can only be refunded, never voided

### YT-0152 · Merchant credentials and request signing
`todo` · P1 · merchant · 4d · dep: YT-0150, YT-0533

- **Re-parented 2026-09-20: `YT-0026` → `YT-0533`.** Per-merchant API keys need key custody and rotation, which YT-0533 provides on Helios; the GCP keyring is deferred
- [ ] Per-merchant API key with HMAC-SHA256 request signing and timestamp replay window
- [ ] Scheduled key rotation with overlap; revocation is immediate
- [ ] Signed webhooks in both directions

### YT-0153 · Enumeration defence and anomaly detection
`todo` · P1 · merchant · 4d · dep: YT-0152

- [ ] Aggressive rate limits; repeated invalid codes from one merchant alerts and auto-throttles
- [ ] Redemption rate, average value and time-of-day profile monitored per merchant
- [ ] Per-merchant, per-batch and global kill switch, tested

### YT-0154 · Manual merchant portal redemption
`todo` · P1 · merchant · 4d · dep: YT-0142, YT-0056

- [ ] Staff type a code, get a confirmation, apply a manual discount — zero integration
- [ ] Mobile-first, huge targets, works on a cheap phone in a busy shop
- [ ] This is the launch path and must ship before the API is offered to anyone

### YT-0155 · Partial redemption policy
`todo` · P1 · merchant · 3d · dep: YT-0151

- [ ] Balance-carrying, single-use-forfeit and minimum-spend, selected per batch
- [ ] Policy displayed prominently before the user spends points
- [ ] Remaining balance visible to the user immediately after capture

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
