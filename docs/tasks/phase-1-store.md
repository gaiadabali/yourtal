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
`todo` · P1 · value · 5d · dep: YT-0026, YT-0041
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
`todo` · P1 · merchant · 4d · dep: YT-0150, YT-0026
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
