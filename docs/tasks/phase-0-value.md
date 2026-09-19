# Phase 0 · Value layer, economy, risk, web foundations

The part that must never be wrong. Nothing here is user-visible; all of it gates Phase 1.

---

## Value

### YT-0041 · Ledger schema and constraints
`todo` · P0 · value · 4d · dep: YT-0022
- [ ] `account` / `entry` / `transfer` tables; entries append-only, no UPDATE or DELETE grant
- [ ] DB-level `CHECK` that a transfer's entries sum to zero
- [ ] `idempotency_key UNIQUE` on transfer; amounts are integer minor units, never float
- [ ] **IDR stored in sen (×100)** even though nobody quotes sen — Stripe and most PSPs treat IDR as a two-decimal currency, and a mismatch here is a 100× error

### YT-0042 · Ledger transfer API
`todo` · P0 · value · 5d · dep: YT-0041, YT-0039
- [ ] `transfer()` writes ≥2 balanced entries in one transaction
- [ ] Replay of an idempotency key returns the original transfer, never a second one
- [ ] Concurrent transfers on one account are serialised and correct under load test

### YT-0043 · Chart of accounts
`todo` · P0 · value · 2d · dep: YT-0041
- [ ] Account taxonomy defined: user, merchant, platform, escrow, charity, suspense, reserve
- [ ] Points liability, breakage revenue and marketing-funded issuance mapped to real accounts
- [ ] Reviewed by whoever owns finance

### YT-0044 · Invariant checker and daily proof
`todo` · P0 · value · 3d · dep: YT-0042
- [ ] Continuous job proves every transfer balances and every cached balance matches entries
- [ ] Daily Merkle root published and stored immutably
- [ ] Any imbalance pages a human; it does not merely log

### YT-0045 · Reward Engine skeleton
`todo` · P0 · value · 5d · dep: YT-0042
- [ ] Sole path from a verified action to a points credit; nothing else may credit
- [ ] Versioned action taxonomy with per-action value, caps and evidence requirements
- [ ] Velocity caps per user, device, IP and day, enforced before the ledger call

### YT-0046 · Partner funding: point pre-purchase and drawdown
`todo` · P0 · value · 5d · dep: YT-0042
- [ ] A business buys a point block at `P_issue`; cash recorded into the segregated reserve
- [ ] Campaigns draw down against an allocation and hard-stop at zero
- [ ] An unfunded issuance attempt is rejected, not queued

### YT-0047 · Solvency monitor and coverage dashboard
`todo` · P0 · value · 4d · dep: YT-0046
- [ ] `Reserve / (points_outstanding × B)` computed continuously
- [ ] Alerts at 1.2; issuance blocked below 1.0
- [ ] Every unfunded grant path requires a matching cash transfer or it fails

## Economy

### YT-0048 · Monetary policy, written down
`todo` · P0 · economy · 3d · dep: YT-0012
- [ ] Opening `P_issue`, `B`, expiry policy, faucet rates and sink list agreed and recorded
- [ ] Devaluation playbook written, including how a change is announced
- [ ] Checked against position ID-1 in `docs/24-legal-positions.md`: no fixed consumer rate is ever published, and `B` never appears in a user-facing surface

### YT-0049 · Pricing engine
`todo` · P0 · economy · 5d · dep: YT-0048
- [ ] `points_price = (S / B) × demand_multiplier`; multiplier fixed at 1.0 for launch
- [ ] Price locked for 15 minutes once shown; never changes between cart and confirm
- [ ] Every price change is audit-logged per SKU

### YT-0050 · Name the economy owner
`todo` · P0 · economy · 2d · dep: —
- [ ] A named analyst or economist is accountable for issuance vs redemption and coverage
- [ ] Daily review checklist agreed

## Risk

### YT-0051 · Device signal interface, web implementation
`todo` · P0 · risk · 4d · dep: YT-0030
- [ ] One interface; web implementation now, native implementation later (Capacitor escape hatch)
- [ ] Fingerprint, headless/automation detection and IP/ASN reputation collected at registration

### YT-0052 · Turnstile and rate limiting
`todo` · P0 · risk · 3d · dep: YT-0025
- [ ] Turnstile on registration, login and any reward claim
- [ ] Per-route, per-identity and per-IP limits with a shared Redis backend

### YT-0053 · WebAuthn passkey enrolment
`todo` · P0 · risk · 4d · dep: YT-0033
- [ ] Passkey enrolment offered after first reward, incentivised with points
- [ ] Passkey presence raises the account's trust tier

### YT-0054 · Risk score service and trust tiers
`todo` · P0 · risk · 5d · dep: YT-0051, YT-0052
- [ ] Tiers 0–3 with distinct earn rates, velocity caps and holdback lengths
- [ ] Reward Engine consults the score before every credit
- [ ] Manual review queue exists with an owner and an SLA

## Web

### YT-0055 · Next.js app shell and design tokens
`todo` · P0 · web · 5d · dep: YT-0030
- [ ] App Router with RSC; server-rendered shell; no client component above the fold
- [ ] Colour, spacing and type tokens defined once in `packages/ui`
- [ ] Dark mode and RTL-safe layout primitives from the start

### YT-0056 · UI primitives package
`todo` · P0 · web · 5d · dep: YT-0055
- [ ] Button, input, select, sheet, dialog, toast, skeleton built on Radix
- [ ] Every primitive keyboard-accessible and screen-reader tested
- [ ] No file in the package exceeds 300 lines

### YT-0057 · CWV budgets in CI and RUM in production
`todo` · P0 · web · 4d · dep: YT-0028, YT-0055
- [ ] Lighthouse CI fails a PR breaching LCP 2.0s / INP 200ms / CLS 0.1 / JS 170KB
- [ ] Throttled to mid-tier Android over 4G, not desktop defaults
- [ ] RUM reports p75 segmented by country, connection and device class

### YT-0058 · Internationalisation scaffolding
`todo` · P0 · web · 3d · dep: YT-0055
- [ ] `id-ID` and `en-AU` locales; no hard-coded user-facing string anywhere
- [ ] Currency, date and number formatting per locale
- [ ] Missing-translation check fails the build

## Data

### YT-0059 · Event schema and ingestion skeleton
`todo` · P0 · data · 4d · dep: YT-0040
- [ ] Versioned event schemas in the contracts package
- [ ] Batched client ingestion; events land in Postgres with a path to ClickHouse later
- [ ] No PII in analytics events without a consent check
