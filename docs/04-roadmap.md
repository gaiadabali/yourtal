# YourTal — Phased Roadmap

**Date:** 2026-09-18
**Sequencing principle:** regulatory-heavy features go last; the ledger goes first; each phase has a **gate** that must pass before the next starts.

Durations assume a team of roughly 8–12 engineers plus product, design, and a fractional legal/compliance lead. They scale with team size, but phase 0 and 1 cannot be meaningfully parallelised beyond ~6 engineers because they are mostly one dependency chain.

---

## Phase −1 — The pilot that costs nothing · ~2–4 weeks · **do this first**

Before any of the below, test the two assumptions the whole model now rests on. No decisioning code, no ledger, no app.

- A landing page, **one hosted 15-minute video** from a real merchant, a Google Form of that merchant's questions, and manually-issued vouchers to the first 200 people who complete it. Promote it however is cheapest.
- **Assumption 1:** will users actually watch 15–30 minutes for a voucher? Measure completion rate, drop-off curve, and whether they answer honestly.
- **Assumption 2:** will a business pay per completed verified view at CAC-level pricing? Get one to actually pay for the 200.
- **Bonus:** you learn the real data-cost objection, the real reward threshold, and whether the questions annoy people, for the price of a weekend.

**Gate −1 →** ≥40% completion on a 15-minute video, and at least one merchant who paid and wants to do it again. If this fails, the plan changes before any money is spent on engineering.

---

## Phase 0 — Foundations & legal design · ~2–3 months

**Goal:** make it possible to build the rest safely. Nothing user-visible ships except a login.

| Workstream | Deliverable                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal      | Counsel opinions in ID + AU on: points classification, cash-out path, prize draws, charity structure. Entity structure decided (PT PMA + Pty Ltd).                                          |
| Identity   | **YourtalID** live: OIDC provider, phone/OTP + social login, one sister app integrated end-to-end.                                                                                          |
| Value      | **Ledger service**: double-entry, append-only, idempotent transfers, invariant checker, daily proofs. No UI.                                                                                |
| Platform   | Event bus, jurisdiction policy service, consent service v1, audit log, authorization (Cerbos)                                                                                               |
| Infra      | Two data planes (Jakarta + Sydney), IaC, CI/CD, observability, secrets/KMS                                                                                                                  |
| Risk       | Phone-OTP mandatory, Turnstile, fingerprinting, WebAuthn passkey enrolment, risk-score service skeleton. **No native attestation available — see [`08`](08-web-app-and-performance.md) §2** |
| Frontend   | Next.js App Router shell, design system, **CWV budgets enforced in CI + RUM segmented by country/device class**                                                                             |
| Clearing   | Partner funding (pre-purchase + drawdown), **segregated float account**, and the **solvency invariant + coverage dashboard** — all required before any business funds a point               |
| Economy    | **Name the economy owner** (analyst/economist). Define `P_issue`, `B`, expiry, faucet rates and the monetary-policy playbook on paper before any point is minted                            |

**Gate 0 →** A sister app can log a user in via YourtalID, call the Reward Engine for a test action, and have the resulting points appear as a balanced pair of ledger entries that survive a replay and a reconciliation run. Legal has signed off on the phase-1 currency model in writing.

---

## Phase 1 — Indonesia MVP: "watch, earn, redeem" · ~3–4 months

**Goal:** prove the core loop with real users and real merchants, in a closed loop, with no regulated money movement.

**In scope**

- **Web app / PWA (ID)**: feed, long-form player (chapters, resume, wake lock, 360–480p default, data-cost shown), streaks/daily check-in, points balance, rewards store. Mobile-first; tablet/desktop responsive
- **Ad platform v1**: advertiser + campaign + creative **ingest/moderation pipeline for 1–30 min video**, managed (human) campaign setup, **question bank authoring + scoring policy**, targeting on geo/age/declared interest only, simple ranking, pacing, delivery
- **Watch Session + checkpoints**: per-checkpoint signed tokens, randomised timestamps, **CDN segment-log cross-check**, chapter-level reward accrual, accuracy bonus
- **Reward Engine**: verified checkpoint → points, with velocity caps, trust tiering and 72 h holdback for new accounts
- **Clearing v1**: per-partner accrual and weekly netting — may be a spreadsheet-assisted manual run at ≤10 partners, but the ledger events must be right from day one
- **Unified store**: vouchers + digital goods in one catalogue, **priced in points by the Pricing Engine** (a fixed multiplier of 1.0 is fine at launch — the formula and `B` are not)
- **Voucher engine**: supplier batches, bulk issuance with approval, rotating signed-QR in-store redemption, per-batch partial-redemption policy
- **Redemption Network**: authorize / capture / void / refund with idempotency, per-merchant HMAC credentials, hold expiry, enumeration defence, kill switch — **plus the manual merchant-portal fallback, which is how the first fifty merchants will actually redeem**
- Points earned from **snap-apps receipt scanning** — the first cross-app proof
- Programmatic backfill (AdMob mediation) so slots are never empty
- Fraud: phone-OTP, passkeys, Turnstile, fingerprinting, velocity, holdback, graph detection, manual review queue
- Finance: points liability reporting, merchant reconciliation, **segregated float reporting**

**Explicitly out of scope:** cash wallet, withdrawals, bidding/auction, charity, chance-based games, self-serve advertiser signup, third-party surveys, ML ranking, **physical merchandise**.

**Gate 1 →** 10+ paying merchants; ≥20% of issued vouchers actually redeemed in-store; **long-form completion rate above target**; fraud loss within budget; 30-day retention above target; **CWV budgets met on mid-tier Android in the field**; ledger, clearing and merchant reconciliation clean for 60 consecutive days.

---

## Phase 2 — Monetisation depth & intelligence · ~3–4 months

**Goal:** make revenue per user real, and make it defensible.

- **Surveys**: in-feed one-question-at-a-time delivery; route to an external panel (Cint / Prodege / Toluna) rather than building supply; honest research disclosure; trap questions and quality scoring
- **Offerwall**: integrate an existing offerwall provider for CPA offers — the highest-eCPM inventory
- **Skill-based mini-games**: 3–4 games, shared reward plumbing, no chance mechanics
- **Digital merchandise**: pulsa/data top-ups, e-vouchers, game credits, subscriptions — fills the store with zero logistics
- **Voucher transfer** (void-and-remint, one hop, verified recipient) — 🔴 counsel review before shipping
- **Shopify app + WooCommerce plugin** — where SMB merchants actually are
- **Dynamic demand multiplier + economy dashboard** live
- **Merchant KYB**: NIB verification and document expiry tracking (hard gate under Permendag 19/2026)
- **Clearing automation**: statements, dispute window, automated payout
- **Recall/brand-lift reporting** productised as a paid advertiser tier
- **Self-serve advertiser console** with LLM-assisted campaign creation, automated creative moderation + human queue, prepaid billing
- **ML v1**: two-tower retrieval + pCTR model; interest inference from sister-app signals; ClickHouse-backed advertiser reporting
- **Measurement credibility**: OM SDK viewability, MRC GIVT filtration, published methodology
- Fraud v2: behavioural graph clustering, cohort anomaly detection

**Gate 2 →** Revenue per active user hits the model; self-serve advertisers can onboard and spend without human intervention; fraud loss below 2% of reward value issued; an advertiser can be shown a credible, auditable delivery report.

---

## Phase 3 — Marketplace, charity & Australia · ~4–5 months

**Goal:** close the loop the brief describes, and open the market that pays.

- **Physical merchandise**: catalogue, inventory with TTL reservations, the points-burn ↔ stock-reserve saga, courier aggregator (Biteship/Shipper in ID), returns, disputes, consumer-guarantee handling
- **Voucher bidding marketplace**: per-auction serialisation, anti-sniping extension, escrow, **void-and-remint on transfer**, effectively-once settlement, dispute handling
- **Charity**: partner-charity integration; proceeds settle directly to the partner's account; distribution reporting; disclosure that the partner is the collector
- **Australia launch**: Sydney data plane, AU entity, AU merchant network, AU consent flows built to the reform's fair-and-reasonable standard, AU trade-promotion compliance
- Cash wallet **in-only** (advertiser billing, marketplace proceeds held as platform credit) — still no withdrawal
- Cross-app points earning live across all sister apps

**Gate 3 →** Auction settlement has zero double-spend and zero duplicate-capture incidents over a full quarter; AU cohort economics beat the model; legal sign-off that the marketplace remains closed-loop.

---

## Phase 4 — Regulated expansion · 6–12+ months, runs in parallel from phase 2

Treated as a **separate programme with its own business case**, not a feature:

- **Cash-out**: AU licensing (AFSL or relief mapping, AUSTRAC, APRA threshold monitoring) and/or ID PJP licensing or a licensed partner
- Permitted **prize draws** as tentpoles (MOSA permits + 10% social contribution in ID; state permits in AU)
- Programmatic demand integration (OpenRTB 2.6) to fill unsold inventory at better rates
- Voucher custody swap-out (consortium chain) _only if_ a partner requires it
- White-label loyalty for large merchants

---

## Team shape

| Pod             | Owns                                                                       | Size                                              |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| **Platform**    | Identity, authz, event bus, consent, jurisdiction, infra                   | 2–3                                               |
| **Value**       | Ledger, points, vouchers, wallet, payments, reward engine                  | 3                                                 |
| **Ad platform** | Advertiser, campaign, creative, decisioning, delivery, pacing, billing     | 3                                                 |
| **Experience**  | Web app (user/advertiser/merchant), feed, player, games, surveys           | 3–4                                               |
| **Commerce**    | Store catalogue, inventory, orders, shipping, returns, merchant KYB        | 2 (from phase 2)                                  |
| **Economy**     | Pricing engine, solvency monitoring, faucet/sink policy, economy dashboard | 1 engineer + **1 analyst/economist from phase 0** |
| **Data & Risk** | Pipeline, CDP, models, fraud, reporting                                    | 2–3                                               |

Phase 0–1 can run with Platform + Value + a thin Ad platform + 2 app engineers (~8 people). Data & Risk must exist by the _end_ of phase 1, not the start of phase 2 — fraud arrives with the first real reward.

## What to buy rather than build

| Thing                                    | Buy                                                                                        | Reconsider building when                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Video encode + delivery                  | Cloudflare Stream                                                                          | Egress is a top-3 cost line                   |
| Identity                                 | Keycloak (self-hosted OSS)                                                                 | Never — but budget patch discipline           |
| Survey supply                            | External panel API                                                                         | We have >1 M engaged users with rich profiles |
| Offerwall                                | Existing provider                                                                          | Our offer inventory is direct-sold and large  |
| Fraud device signals                     | Fingerprinting vendor + platform attestation                                               | Our own signals outperform, ~2 years in       |
| Payments                                 | Xendit (ID payouts) + Midtrans/Xendit (ID collection), Stripe (AU)                         | Never                                         |
| Analytics / BI                           | ClickHouse + Grafana/Metabase                                                              | —                                             |
| Ad server                                | **Build** — the reward loop, voucher funding and points pricing have no vendor equivalent  | —                                             |
| Courier logistics                        | Aggregator (Biteship / Shipper in ID, Shippit in AU) — never integrate couriers one by one | Never                                         |
| Digital goods supply (pulsa, e-vouchers) | Aggregator API                                                                             | Never                                         |
| Bot / fingerprint signals                | Turnstile + a commercial fingerprint vendor                                                | Our signals outperform, ~2 years in           |
