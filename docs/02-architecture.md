# YourTal — Target Architecture

**Date:** 2026-09-18
**Status:** Proposed. Every choice marked **[D#]** is an open decision — see `05-open-questions.md`.

> **Revision note.** Client context added 1–30 min video with business-authored questions ([`06`](06-longform-video-and-attention.md)), business-funded points cross-redeemable between partners ([`07`](07-coalition-clearing-and-commerce.md)), web/PWA instead of native ([`08`](08-web-app-and-performance.md)), and points-only rewards with per-business store pricing plus merchant-side redemption ([`09`](09-points-economy-and-redemption.md)). Four domains added — Pricing, Solvency, Redemption Network, Commerce. **Stack superseded by [`15-stack-locked.md`](15-stack-locked.md); the ledger schema below matches what was built in YT-0518.**

---

## 1. Architectural principles

1. **The ledger is sacred.** One service owns balances, append-only and double-entry. No other service writes a balance — they emit events and ask for a transfer. _(Capillary rebuilt their loyalty platform on this lesson.)_
2. **Nothing of value is credited on a client's word.** Rewards are granted server-side after verification, never by an SDK callback.
3. **Build the platform foundation first.** Identity, Ledger, Event Bus, before any headline feature. This is what Gojek and Grab say in retrospect and what every super-app post-mortem repeats.
4. **Separate by frequency of access, not by function.** Ad decisioning (100k+ rps, 30 ms) and voucher issuance (100 rps, 500 ms) have nothing in common and must never share a deployment, a datastore or an on-call rotation.
5. **Country is a hard boundary.** ID and AU are separate data planes, separate ledgers, separate legal entities. No user, point, voucher or dollar crosses the border. A shared control plane deploys the same code to both.
6. **Everything of value is idempotent and replayable.** Every value-moving API takes a client-supplied idempotency key. Every consumer is idempotent. Exactly-once is achieved by effectively-once, not by wishing.
7. **Regulatory features are switches, not rewrites.** Cash-out, prize draws, cross-border — each is a feature flag guarded by a jurisdiction policy service, so a legal change is a config change.

## 2. Domain map (bounded contexts)

```
                              ┌──────────────────────────────────────┐
                              │        L0  PLATFORM FOUNDATION       │
                              ├──────────────────────────────────────┤
  snap-apps ───┐              │ YourtalID (OIDC)   Consent & Privacy │
  freetax    ──┼── SDK ─────► │ Authorization      Event Bus         │
  uniqueWL   ──┤              │ Jurisdiction Policy  Audit Log       │
  humanspedia ─┘              └──────────────────────────────────────┘
                                              │
   ┌──────────────────────────────────────────┼──────────────────────────────────────────┐
   ▼                     ▼                    ▼                   ▼                      ▼
┌────────────┐   ┌────────────────┐   ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐
│ L1  VALUE  │   │ L2  AD PLATFORM│   │ L3 ENGAGEMENT│   │ L4 MARKETPLACE │   │ L5  DATA / AI    │
├────────────┤   ├────────────────┤   ├──────────────┤   ├────────────────┤   ├──────────────────┤
│ Ledger     │   │ Advertiser     │   │ Feed         │   │ Store (unified)│   │ Event pipeline   │
│ Points     │   │ Campaign       │   │ Watch session│   │ Commerce ★     │   │ CDP / profiles   │
│ Pricing ★  │   │  + Questions ★ │   │ Mini-games   │   │  catalogue,    │   │ Feature store    │
│ Solvency ★ │   │ Creative+Media │   │ Surveys      │   │  inventory,    │   │ Ranking models   │
│ Voucher    │   │  ingest/mod ★  │   │ Streaks/quest│   │  orders, ship  │   │ Risk / fraud     │
│ Redemption │   │ Decisioning    │   │ Notifications│   │ Auction/bidding│   │ Economy dash ★  │
│  network ★ │   │ Delivery+track │   │              │   │ Escrow+settle  │   │ Reporting (OLAP) │
│ Wallet     │   │ Pacing+billing │   │              │   │ Charity        │   │                  │
│ Payments   │   │                │   │              │   │ Merchant portal│   │                  │
│ Reward eng.│   │                │   │              │   │  + KYB ★       │   │                  │
│ Clearing ★ │   │                │   │              │   │                │   │                  │
│ Partner    │   │                │   │              │   │                │   │                  │
│  funding ★ │   │                │   │              │   │                │   │                  │
└────────────┘   └────────────────┘   └──────────────┘   └────────────────┘   └──────────────────┘
                              ★ = added after client context
```

### L0 — Platform foundation

| Service                 | Responsibility                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **YourtalID**           | OIDC provider. One client per sister app. Authorization Code + PKCE. Scoped consent screen ("snap-apps wants: your profile, your points balance"). Refresh-token rotation. Social + phone/OTP login (phone-first for ID, email/Apple/Google for AU). |
| **Consent & Privacy**   | Purpose-scoped consent records with versioned policy text, per jurisdiction. Serves "may I use this signal for ad targeting?" to every other service. DSAR / deletion orchestration.                                                                 |
| **Authorization**       | Central policy decision point (Cerbos or OPA). Roles: user, business admin, business member, charity admin, merchant staff, internal (support / finance / ops / admin). **[D1]**                                                                     |
| **Event Bus**           | Kafka (or Redpanda). The spine. Every domain event, replayable, schema-registered.                                                                                                                                                                   |
| **Jurisdiction Policy** | Single source of truth for "what is legal/enabled for this user in this country right now": cash-out on/off, prize draws on/off, min age, data-residency region, KYC tier required.                                                                  |
| **Audit Log**           | Append-only, hash-chained, write-only-from-services record of every privileged action. Required for voucher bulk issuance, ledger adjustments, campaign approvals.                                                                                   |

### L1 — Value layer (the part that must never be wrong)

| Service                     | Responsibility                                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ledger**                  | Double-entry, append-only, per-country. Owns all point and cash balances. Sole writer. Exposes `transfer(from, to, amount, currency, idempotency_key, reason_code)`. Daily Merkle root published for tamper-evidence.                                                     |
| **Points**                  | Earn rules, expiry, tiers, faucet configuration. Issues ledger transfers; never holds balances itself. Pricing lives in the Pricing Engine, not here.                                                                                                                     |
| **Voucher**                 | Issuance (single + bulk), lifecycle, code custody, **transfer via void-and-remint (one hop, verified recipient)**, partial-redemption policy per batch, merchant reconciliation.                                                                                          |
| **Wallet**                  | Cash balances (AUD / IDR), per-country, KYC-tiered. Disabled by flag until licensing exists.                                                                                                                                                                              |
| **Payments**                | Advertiser billing (card / PayTo / VA / QRIS), merchant settlement, payouts, refunds, chargebacks. Adapter per PSP.                                                                                                                                                       |
| **Reward Engine**           | The _only_ component that converts a verified user action into points. Every earn goes through it: rule evaluation, caps, velocity limits, risk score gate, then a ledger transfer.                                                                                       |
| **Partner Funding** ★       | Businesses pre-purchase point blocks at `P_issue`; campaigns draw down against an allocation. Prevents YourTal ever awarding an unfunded point.                                                                                                                           |
| **Pricing Engine** ★        | Computes `points_price = (S / B) × demand_multiplier` for every listing. Owns the backing rate `B`, the multiplier bounds, price locks in cart, and the price-change audit log. **The economy's monetary authority.** See [`09`](09-points-economy-and-redemption.md) §4. |
| **Solvency Monitor** ★      | Continuously evaluates `Reserve / (points_outstanding × B) ≥ 1.0`. Alerts below 1.2. Blocks unfunded issuance. The cheapest insurance in the platform.                                                                                                                    |
| **Redemption Network** ★    | Merchant-facing authorize / capture / void / refund API, per-merchant credentials and HMAC signing, hold expiry, enumeration defence, per-merchant kill switch. See [`09`](09-points-economy-and-redemption.md) §8.                                                       |
| **Clearing & Settlement** ★ | Accrues per-partner obligations both ways (points issued vs. value honoured), nets them per cycle, produces immutable signed statements, triggers payout. Holds the segregated partner float. See [`07`](07-coalition-clearing-and-commerce.md) §2.                       |

### L2 — Ad platform

| Service                 | Responsibility                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Advertiser**          | Business accounts, users, billing entity, KYB verification, credit terms.                                                                                                                                                                                                                                    |
| **Campaign**            | Campaign / ad-set / ad hierarchy, objectives, targeting spec, budget, schedule, frequency caps, **reward config** (points drawn from the partner's funded allocation, and/or voucher batch, and/or merchandise listing), **chapter & checkpoint definition**, and the **question bank** with scoring policy. |
| **Creative & Media**    | Upload (1–30 min), hash-dedupe, ASR transcript + frame sampling, automated policy screen, human moderation queue keyed to flagged timestamps, ABR encode capped at 720p, chapter markers, hot→warm→cold lifecycle. See [`06`](06-longform-video-and-attention.md) §6.                                        |
| **Decisioning**         | The hot path. Retrieval → pre-rank → rank → auction → pacing filter → response. Latency budget below.                                                                                                                                                                                                        |
| **Delivery & Tracking** | Impression / quartile / completion / click beacons, view verification token issuance, OM SDK integration, IVT filtration.                                                                                                                                                                                    |
| **Pacing & Billing**    | Budget pacing (participation probability), spend accrual, reconciliation against verified events, invoicing.                                                                                                                                                                                                 |

### L3 — Engagement

Feed (the surface mixing campaigns, questions and quests), **Watch Session** (the core: resumable position, chapter progress, checkpoint delivery, answer capture, accrual state — the most important service in L3), mini-games (skill-based, sandboxed), surveys (in-feed one-at-a-time delivery + panel routing), streaks/quests, notifications.

### L4 — Marketplace & commerce

Rewards store (burn points → voucher / merchandise / digital goods), **Commerce** ★ (catalogue, inventory with TTL reservations, orders, the points-burn ↔ stock-reserve saga, shipping adapters, returns, disputes), auction/bidding, escrow & settlement, charity settlement, **Merchant portal + KYB** ★ (NIB verification under Permendag 19/2026, voucher redemption, campaign performance, recall reporting). See [`07`](07-coalition-clearing-and-commerce.md) §4.

### L5 — Data & AI

Event pipeline, CDP/profile store, feature store, ranking models, risk/fraud models, OLAP reporting.

## 3. The ad serving hot path

**Latency budget: 120 ms p99 end-to-end, 30 ms p99 inside decisioning.**

```
 client                edge                    decisioning                    stores
   │                    │                           │                            │
   ├─ POST /decision ──►│                           │                            │
   │  (flat, <10KB,     ├─ auth + geo + rate ──────►│                            │
   │   HTTP/2 reuse)    │                           ├─ user features ───────────►│ Redis (<2ms)
   │                    │                           ├─ eligible candidates ─────►│ in-proc index
   │                    │                           │    (targeting + freq cap)  │  (rebuilt 1-5 min)
   │                    │                           ├─ pre-rank: cheap pCTR      │
   │                    │                           ├─ rank: pCTR x bid = eCPM   │
   │                    │                           ├─ pacing filter ───────────►│ Redis token bucket
   │                    │                           ├─ auction + floor           │
   │                    │◄── winner + VAST + ───────┤                            │
   │◄─ response ────────┤    signed view_token      │                            │
   │                    │                           │                            │
   ├─ preload FIRST SEGMENTS only (never a 30-min asset on cellular) ──────────►│ CDN
   │
   ├─ play chapter, report position ───────────────────────────────────────────►│ Watch Session
   ├─ checkpoint reached: POST /checkpoint { token_n, answer } ────────────────►│ verification
   │                                                       │
   │                     verify signature + nonce, answer, response latency,
   │                     CLAIMED POSITION vs CDN SEGMENT LOG, risk score
   │                                                       │
   │◄──── chapter reward accrued (server-side, per checkpoint) ────┤ Reward Engine -> Ledger
   │
   ├─ final questions → accuracy bonus ────────────────────────────────────────►│
```

> Reward **accrues per checkpoint**, not once at the end: abandon at minute 12 and you keep what you earned, and a fraudster must defeat every checkpoint rather than one callback.

**Design notes**

- **Candidate index in-process.** The eligible-ad set for a country is small enough (thousands to low millions) to hold in memory per decisioning pod, rebuilt from Kafka every 1–5 minutes. Avoids a network hop in the hot path. This is what lets us hit 30 ms without exotic infrastructure.
- **Redis/Valkey for the mutable hot state only**: frequency caps, pacing buckets, per-user recent-view sets, session context.
- **Pacing = token bucket per campaign per minute**, refilled from a delivery schedule that the pacing service recomputes every minute from forecast supply. Decisioning only reads. Overspend is bounded by one refill interval. **[D2]** — do we allow Google-style 2x daily / monthly balancing, or hard daily caps?
- **Per-checkpoint tokens are the security model.** Each is signed server-side, contains `{user, campaign, chapter, checkpoint_index, issued_at, nonce}`, has a short TTL and is single-use (nonce burned in Redis). Checkpoint timestamps are chosen server-side and randomised per user so the client cannot precompute them. Reward accrues only on a valid, unburned token **with a plausible timeline, a scored answer, and a claimed position consistent with the CDN segment log.**
- **Decisioning is lighter here than in a classic ad server.** Campaigns are direct-sold and long-form, so the candidate set per user is small and the cadence is a few sessions a day, not hundreds of impressions. The 30 ms budget still applies to the feed, but the extreme-scale retrieval/pre-rank cascade is a phase-2 concern, not a phase-1 one. **Do not build Andromeda for 200 campaigns.**

## 4. Reward integrity — the anti-fraud spine

This is the system that decides whether YourTal is a business or a money pump for device farms.

> ⚠️ **Web changes this materially.** Shipping as a PWA means **no Play Integrity and no App Attest** — the strongest control in the native plan is simply unavailable. The compensating stack is in [`08-web-app-and-performance.md`](08-web-app-and-performance.md) §2.1, and the table below is the web version. Two things carry most of the lost weight: **mandatory phone-OTP** (unusually strong in Indonesia, where SIM registration is NIK/KK-bound with per-NIK limits) and the **CDN segment-log cross-check**, which needs no client cooperation at all.

**Layered, in order of when they fire:**

| Layer                   | Check                                                                                                                                                                                                                                                                                                                        | Blocks                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Registration**        | **Mandatory phone OTP**, Turnstile, fingerprint (weighted lower on web), IP/ASN reputation, headless/automation detection                                                                                                                                                                                                    | Mass account creation                                                                         |
| **Device binding**      | **WebAuthn passkey enrolment** for reward-bearing accounts (secure-enclave-bound), incentivised with a points bonus                                                                                                                                                                                                          | One operator running hundreds of browser profiles                                             |
| **Session**             | Short-lived signed session, visibility + focus enforcement, **Screen Wake Lock**, single concurrent reward session per user                                                                                                                                                                                                  | Backgrounded "watching", parallel farming                                                     |
| **Per-event**           | **Per-checkpoint** signed single-use tokens (not one per video), randomised checkpoint timestamps, timing plausibility, answer latency and entropy                                                                                                                                                                           | Replay, scripted completion                                                                   |
| **Server truth**        | **Claimed playback position cross-checked against CDN segment-delivery logs**                                                                                                                                                                                                                                                | Any client that claims watch time it never fetched — the strongest web-native control we have |
| **Velocity**            | Per-user / per-device / per-IP / per-household caps per hour and per day; earn caps by tier                                                                                                                                                                                                                                  | Grinding, multi-accounting                                                                    |
| **Behavioural (async)** | Graph clustering on device/IP/payment/referral edges; impossible-timing detection; identical-flow detection across accounts; D1 retention by cohort                                                                                                                                                                          | Farms that pass every single-event check                                                      |
| **Value gate**          | **Holdback period** between earning points and being able to burn them — **start at 72 h for new accounts on web**, decaying with account trust — plus a risk-score threshold and a manual review queue above a value threshold. **Trust tiering:** new/unverified accounts earn at a reduced rate until they build history. | Cash-out before detection                                                                     |
| **Reconciliation**      | Daily ledger balance proof; voucher issued-vs-redeemed reconciliation with merchants; anomaly alerts on breakage rate changes                                                                                                                                                                                                | Internal fraud, bugs                                                                          |

**The holdback is the most important single control.** Fraud detection is statistical and lags the event. A delay between earning and irreversible redemption is what converts "we got robbed" into "we clawed back a suspended balance."

**Referral fraud deserves its own design.** It is named in the research as a primary emulator use case, and referral programmes are where reward platforms bleed. Rule: referral rewards pay on the _referee's_ sustained verified activity (e.g. day-7 retention + N verified actions), never on signup.

## 5. Voucher engine design

### 5.1 Data model (sketch)

```
voucher_batch      id, merchant_id, campaign_id, face_value, currency, terms_id,
                   quantity, funding_model {merchant_funded | platform_purchased |
                   consignment}, issued_by, approval_chain, created_at

voucher            id, batch_id, state {minted, allocated, held, active, redeemed,
                   expired, voided, transferred_out}, owner_user_id, code_hash,
                   code_encrypted, serial, expires_at, redeemed_at, redeemed_by_store,
                   version
                   -- code itself: >=16 chars, CSPRNG, no prefix/counter, checksum

voucher_event      voucher_id, seq, event_type, actor, prev_hash, hash, payload, at
                   -- append-only, hash-chained per voucher
```

- **Code never stored in plaintext.** Look up by **HMAC with a KMS-held pepper** so a database dump yields no usable codes; keep an envelope-encrypted copy for display to the owner only. **[D3] RESOLVED — GCP Cloud KMS at HSM protection level**, per-country keyring.
- **Bulk issuance is a two-person, audited operation**: request → approval → async mint job → signed manifest → merchant notified. Every batch has a funding record so the liability is always attributable.
- **State transitions are guarded and versioned** (optimistic concurrency). `redeemed` is terminal and irreversible.

### 5.2 Redemption

Two modes, both cryptographic:

**Online (merchant website / API):** merchant calls the authorize/capture API with code + amount + order ref + idempotency key, signed with **HMAC-SHA256 over a canonical request** (mandatory for every merchant; mTLS optional above a settlement threshold — HMAC survives Cloudflare TLS termination and gives payload-level non-repudiation). See [`14`](14-security-engineering.md). Server validates, marks redeemed atomically, returns a signed receipt. Rate-limited, per-merchant velocity monitored, alerting on failed-lookup spikes (the enumeration signal).

**In-store (POS / staff phone):** user's app renders a **rotating signed QR** — Ed25519 signature over `{voucher_id, user_id, nonce, exp}`, CBOR-encoded, **30–60 s validity**. Merchant staff app scans and calls the API; or, if offline, verifies the signature locally against a cached public key and queues the redemption for sync with a conflict-resolution rule. This kills screenshot sharing without requiring any POS integration.

### 5.3 Transfer / sale (the Cardpool lesson)

When a voucher changes hands through the auction:

```
1. seller's voucher -> state: held (escrow), code frozen
2. buyer pays -> funds held in escrow
3. platform VOIDS the original code and MINTS A NEW ONE for the buyer
4. new code delivered to buyer; old code is permanently dead
5. funds released to seller's wallet/charity
```

Never transfer ownership of a live code. The seller's knowledge of the old code must be made worthless by construction.

**[D4]** — Do merchants have to accept transferred vouchers? Some will demand non-transferability. This should be a per-batch flag set at issuance, and transferable/non-transferable status must be visible to the user _before_ they burn points.

## 6. Ledger design

```
account            id, country, owner_type {user, merchant, platform, escrow, charity,
                   suspense}, owner_id, currency {YTP, IDR, AUD}, kind {asset,
                   liability, revenue, expense, equity}

entry              id, transfer_id, account_id, amount_minor (SIGNED), currency,
                   created_at                   -- append-only, never updated
                   -- Signed amount, not a direction enum, as built: "sums to
                   -- zero" is then a direct SUM with no CASE.

transfer           id, idempotency_key UNIQUE, reason_code, reference {campaign,
                   voucher, order, payout}, status, created_at, metadata
```

- Every transfer has **≥2 entries summing to zero**. Enforced in the write path _and_ by a continuous invariant checker.
- **Points are a liability account** of the platform, matching the ASC 606 treatment. Issuance debits marketing/contra-revenue and credits the points liability; redemption reverses it; expiry recognises breakage.
- **No cross-currency transfer inside a single transfer.** Point→voucher is two linked transfers plus a voucher allocation, tied by a saga with a compensating action.
- **Balances are derived, then cached.** The cached balance is a materialised projection with a version; it is rebuilt from entries on demand and reconciled nightly.
- **[D5]** — Postgres-based ledger (simple, one less system, adequate to ~10k TPS with care) vs. TigerBeetle (purpose-built, far faster, another operational surface). Recommendation: **Postgres now, keep the interface narrow enough that TigerBeetle is a swap.**

## 7. Technology choices

> ⚠️ **Superseded by [`10-tech-stack.md`](10-tech-stack.md).** The table below was sized for classic ad-network load (100k+ rps). The real load is **~500 rps at 1M DAU**, because campaigns are direct-sold and long-form — users have 2–10 watch sessions a day, not 500 impressions. The revised stack is smaller: **TypeScript end to end, one Postgres, Cloud Run, no Kafka, no Kubernetes, a modular monolith rather than ~25 services.** Doc 10 also carries the finding that **video delivery is ~90% of infrastructure cost** and everything else is a rounding error. Keep this table only as the logical domain reference.

| Concern                             | Choice                                                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ad decisioning, ledger, voucher** | **Go**                                                                                                                                                                                             | Predictable latency, low memory, no GC surprises in a 30 ms budget; strong for the correctness-critical services.                                                                                                                                                                                                                                                          |
| **Business services / BFF**         | **NestJS (TypeScript)**                                                                                                                                                                            | Structured, DI, consistent across a team; anyone can move between services. Shares types with the web front end.                                                                                                                                                                                                                                                           |
| **ML / data**                       | **Python**                                                                                                                                                                                         | Non-negotiable ecosystem.                                                                                                                                                                                                                                                                                                                                                  |
| **Primary OLTP**                    | **PostgreSQL** (one database per service, never shared tables)                                                                                                                                     | Boring, correct, everyone knows it. Gojek's choice at scale.                                                                                                                                                                                                                                                                                                               |
| **Hot state**                       | **Redis / Valkey**                                                                                                                                                                                 | Frequency caps, pacing buckets, sessions, auction serialisation via atomic Lua.                                                                                                                                                                                                                                                                                            |
| **Event bus**                       | **Kafka** (or Redpanda for lower ops)                                                                                                                                                              | Replayable spine; the research-backed default for both adtech and super-apps.                                                                                                                                                                                                                                                                                              |
| **Analytics / reporting**           | **ClickHouse**                                                                                                                                                                                     | Ad event volume (impressions, quartiles, clicks) is the classic ClickHouse workload; Postgres will not survive it.                                                                                                                                                                                                                                                         |
| **Feature store**                   | Redis online + ClickHouse/Parquet offline                                                                                                                                                          | Keep it simple until model complexity demands Feast et al.                                                                                                                                                                                                                                                                                                                 |
| **Video**                           | **Cloudflare Stream** (phase 1) behind an internal media abstraction                                                                                                                               | Per-_minute_ pricing (not per-GB) is strongly favourable for 1–30 min content: $0.03 for a full 30-min view, encoding and storage included. Requires a cold-archive lifecycle policy. **[D6]**                                                                                                                                                                             |
| **Identity**                        | **Keycloak** self-hosted                                                                                                                                                                           | No per-MAU fee (decisive at consumer scale), OIDC-complete, realms per country. Cost: CVE patch discipline. **[D7]**                                                                                                                                                                                                                                                       |
| **Authorization**                   | **Cerbos** (policy-as-code, stateless PDP)                                                                                                                                                         | Fits multi-role, multi-tenant; auditable policies.                                                                                                                                                                                                                                                                                                                         |
| **Client**                          | **[D8] RESOLVED — web app / PWA.** Next.js App Router + RSC, edge-rendered in-region, Tailwind + headless primitives, `hls.js` player loaded on intent, service worker for offline voucher display | One codebase for the user app (mobile-first), advertiser console (desktop-first) and merchant portal (mobile-first, ruthlessly). Enforced CWV budgets: LCP ≤ 2.0 s, INP ≤ 200 ms, initial JS ≤ 170 KB, measured on mid-tier Android over 4G. **Capacitor wrap is the documented escape hatch** if fraud demands Play Integrity. See [`08`](08-web-app-and-performance.md). |
| **Device signals**                  | One interface, web implementation now, native implementation later                                                                                                                                 | Keeps the Capacitor escape hatch cheap                                                                                                                                                                                                                                                                                                                                     |
| **Infra**                           | Kubernetes, IaC (Terraform), GitOps                                                                                                                                                                |                                                                                                                                                                                                                                                                                                                                                                            |
| **Cloud**                           | **[D9]** — GCP (Jakarta + Sydney regions, Gojek-proven in ID) or AWS (Jakarta + Sydney)                                                                                                            | Both have ID + AU regions, which is the hard requirement.                                                                                                                                                                                                                                                                                                                  |
| **Observability**                   | OpenTelemetry → Grafana stack (Mimir/Loki/Tempo)                                                                                                                                                   |                                                                                                                                                                                                                                                                                                                                                                            |

**Deliberately NOT chosen at phase 1:** blockchain, custom CDN, custom transcoding pipeline, custom offerwall, custom survey panel, service mesh, multi-region active-active.

## 8. Deployment topology

```
        ┌────────────────── CONTROL PLANE (single) ──────────────────┐
        │  CI/CD · IaC · secrets · admin console · global observability │
        └──────────┬─────────────────────────────┬────────────────────┘
                   │                             │
   ┌───────────────▼──────────────┐  ┌───────────▼──────────────────┐
   │   DATA PLANE — INDONESIA     │  │   DATA PLANE — AUSTRALIA     │
   │   region: Jakarta            │  │   region: Sydney             │
   │   entity: PT YourTal ...     │  │   entity: YourTal Pty Ltd    │
   │   PII, ledger, vouchers,     │  │   PII, ledger, vouchers,     │
   │   events — stay here         │  │   events — stay here         │
   │   PSE-registered             │  │   Privacy Act / APP          │
   └──────────────────────────────┘  └──────────────────────────────┘
              only aggregated, non-identifying metrics
              flow to the control plane for group reporting
```

Same code, same schema, different data. A user who moves country gets a **new account**, not a migration. This is the cheapest possible answer to PDP/PSE, the Privacy Act, and any future licensing condition — and it makes each country independently sellable or shutdownable.

## 9. Sister-app integration contract

What snap-apps / freetaxreturns / uniqueweightloss / humanspedia get:

1. **`@yourtal/auth`** — OIDC login. Drop-in. Users log in once across the group.
2. **`@yourtal/earn`** — server-side SDK: `POST /actions` with `{user_id, action_type, external_ref, idempotency_key, evidence}`. The Reward Engine evaluates the rule, applies caps and risk, and grants points. **Sister apps never grant points directly.**
3. **`@yourtal/widgets`** — points balance chip, "earn more" entry point, reward-store deeplink.
4. **Webhook back-channel** — `points.granted`, `points.reversed`, `voucher.issued` so the sister app can show a confirmation.

**Action taxonomy is versioned and centrally governed.** `snapapps.receipt.scanned` with a declared value band, caps, and evidence requirements. Sister apps propose actions; the platform approves them, because every action type is a liability the platform will have to honour.

**Fraud is shared.** A device banned for receipt fraud in snap-apps is banned for ad rewards in YourTal. One risk service, all apps.

## 10. Security posture (summary)

- **Ledger and voucher services** run in a separate network zone with their own service accounts, their own database credentials, and no direct internet ingress.
- **PCI:** never touch card data — PSP-hosted fields only, keeping us at SAQ-A.
