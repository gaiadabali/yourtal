# YourTal — The Engines: what each covers, and how smart it actually is

**Date:** 2026-09-19

Fourteen engines. The honest answer to *"how smart are they?"* is that **four of them are deliberately stupid and must stay that way**, four have to be genuinely intelligent because they are adversarial or high-volume, and the rest are rules that earn intelligence over time.

A system that is clever everywhere is a system nobody can audit. **Cleverness goes where it compounds; correctness goes where it is provable.**

| Rating | Means |
|---|---|
| ▪▪▪▪ | ML / adversarial / adaptive |
| ▪▪▪ | Statistical, learns from data, not a model |
| ▪▪ | Parameterised rules with feedback |
| ▪ | Deterministic. **Smart is a bug here.** |

---

## The four that must stay dumb

These decide whether money is real. Every one is auditable by a human with a spreadsheet, and that is the point.

### 1. Ledger ▪
**Covers:** every point and cash balance in both countries. Sole writer.
Append-only double-entry, integer minor units (IDR in **sen**), DB-enforced balance-to-zero, unique idempotency keys, hash-chained entries, daily Merkle root.
**Why dumb:** the moment a balance depends on a model, no one can prove the books. There is no scenario in which a clever ledger is better than a boring one.

### 2. Solvency Monitor ▪
**Covers:** `Reserve ÷ (points outstanding × B) ≥ 1.0`.
Alerts at 1.2, stops promotional faucets at 1.1, blocks unfunded issuance at 1.0.
**Why dumb:** it is arithmetic, continuously evaluated. It exists to catch the silent failure — points minted with no cash behind them — and a heuristic that "usually" catches insolvency is worthless.

### 3. Redemption Network ▪
**Covers:** authorize → capture → void → refund at the merchant's own checkout.
Holds with TTL, capture bounded by authorize, idempotency mandatory, **no balance-lookup endpoint**, per-merchant HMAC signing and kill switch.
**Why dumb:** it is a state machine crossing an organisational boundary. Card networks solved this in the 1970s and the answer has not improved.

### 4. Clearing & Settlement ▪
**Covers:** per-partner obligations both directions, netted per cycle, immutable signed statements, payout.
**Why dumb:** every figure must drill through to ledger events. Partner disputes are won with arithmetic, not with explanations of a model.

---

## The four that must be genuinely smart

### 5. Risk & Fraud Engine ▪▪ → ▪▪▪▪
**Covers:** registration, session, per-event, velocity, behavioural clustering, trust tiering, referral abuse, answer-key leakage, merchant-side anomalies.

| Phase | Intelligence |
|---|---|
| P1 | Layered **rules**: device fingerprint, phone-OTP identity anchor, Turnstile, timing plausibility, velocity caps, impossible-flow detection, per-checkpoint token verification |
| P1 | **CDN segment-log cross-check** — claimed watch position against bytes actually delivered. Deterministic, needs no client cooperation, and the single hardest control to defeat |
| P2 | **Graph clustering** on device / IP-ASN / phone prefix / payout destination / referral edge / answer pattern |
| P2 | **Gradient-boosted risk scoring** with rules retained as a fallback |
| P3 | Sequence models over behaviour; adaptive thresholds per cohort |

**This is where the most intelligence belongs**, because it is the only adversarial engine — the opponent adapts. It also carries more weight here than at a native-app competitor, because shipping as web cost us Play Integrity and App Attest.

**Deliberate constraint:** suspected accounts are **suspended and escrowed, never silently zeroed**, and every decision is appealable. Meta has disclosed that up to 2 in 10 enforcement actions may be mistakes; assume we are no better.

### 6. Moderation Engine ▪▪▪▪ (from day one)
**Covers:** 1–30 minute creatives and their question banks, before publication.

Pipeline: hash dedupe → ASR transcript → frame sampling + OCR → **LLM policy screen (Claude Sonnet 5)** producing per-timestamp flags → human reviews *only flagged timestamps*.

Checks restricted categories per jurisdiction (alcohol, gambling, therapeutic goods, financial products, children), unsupportable claims, IP and competitor use, and — importantly — **questions that smuggle PII collection** into a reward gate.

**Why smart from day one:** the alternative is a human watching thirty minutes per creative. The LLM does not approve anything; it only decides what a human must look at. That asymmetry is what makes it safe to rely on.

### 7. Campaign Selection & Ranking ▪▪ → ▪▪▪▪
**Covers:** which campaigns a user sees, in what order, on Earn and Quick.

| Phase | Intelligence |
|---|---|
| P1 | Filter (targeting, frequency cap, pacing, already-completed) then sort by simple expected value. **Do not build Andromeda for 200 campaigns.** |
| P2 | **p(completion)** model — our equivalent of pCTR, and the more honest objective, since an abandoned 25-minute view helps nobody |
| P2 | Two-tower retrieval once the catalogue justifies it |
| P3 | Multi-objective (MMoE-style) balancing advertiser value, user satisfaction and platform margin |

**The objective is different from an ad network's.** Google optimises for clicks; we optimise for *completed, verified, satisfying* exchanges. Ranking a campaign a user will abandon at minute 3 costs us delivery minutes and costs the advertiser nothing — so it is worse than not showing it.

### 8. Interest & Profile Engine (CDP) — P2 ▪▪▪
**Covers:** declared interests, on-platform behaviour, question answers, and — the moat — **verified purchase data from snap-apps receipt scanning**.

Meta *infers* what you bought. We would *observe* it. That is the most valuable targeting signal in the platform and the reason the sister-app strategy is more than cross-promotion.

**Constrained by design:** consent-gated per purpose, country-isolated, cohort-level for advertisers, never user-level export. Individual behavioural targeting is an explicit opt-in tier, not the default — which is both the right call and where Australia's privacy reform is heading.

---

## The six that are rules, sharpening over time

### 9. Reward Engine ▪▪
**Covers:** the *only* path from a verified action to a points credit. Versioned action taxonomy, per-action value, caps, evidence requirements, velocity limits, risk gate, then a ledger transfer.
Sister apps call it; they never credit directly. It gets smarter only in its *inputs* (risk score, trust tier), never in its arithmetic.

### 10. Pricing Engine ▪▪ → ▪▪▪
**Covers:** `points_price = (S / B) × demand_multiplier` for every listing, price locks, the audit trail of every change.
P1 ships with the multiplier pinned at 1.0 — but the formula and `B` must exist from day one. P2 adds demand and scarcity signals, bounded 0.8–1.25×.
**Guardrails over cleverness:** bounded movement, price locked once shown, and no per-user price discrimination on identical items — legally fraught in both markets, and it *will* be screenshotted.

### 11. Question Engine ▪▪▪
**Covers:** checkpoint placement, per-user subset selection, option shuffling, timers, scoring, and **leak detection**.
The statistical part is real: population accuracy is tracked per question, and a jump from 61% to 97% overnight auto-retires it and flags the cohort. **Assume the answer key leaks — `jawaban YourTal` will be a Telegram channel within a week — and detect it fast rather than trying to stay secret.**

### 12. Attention Verification ▪
**Covers:** per-checkpoint signed single-use tokens at server-randomised timestamps, foreground and wake-lock enforcement, playback-rate lock, and the CDN cross-check.
**Deliberately deterministic.** A probabilistic "this looks like a real viewer" score would be negotiable; a cryptographic token with a burned nonce is not.

### 13. Pacing Engine ▪▪
**Covers:** per-campaign token buckets refilled from a delivery schedule, so overspend is bounded by one refill interval and a campaign can never exceed its funded allocation.
A control loop, not a model. It gets a forecaster in P2 if guaranteed delivery is ever sold.

### 14. Lifecycle & Notification Engine ▪▪ → ▪▪▪
**Covers:** streaks, expiry warnings, "your voucher is about to expire", re-engagement, web push and WhatsApp in Indonesia.
Rules in P1; propensity-based send-time and channel selection in P3. Every notification has an off switch that works the first time.

---

## The honest summary

| | Engines | Why |
|---|---|---|
| **Provably correct** | Ledger, Solvency, Redemption, Clearing | Money. Auditable by hand or it does not ship |
| **Genuinely intelligent** | Risk, Moderation, Ranking, CDP | Adversarial or too high-volume for humans |
| **Rules that sharpen** | Reward, Pricing, Question, Attention, Pacing, Lifecycle | Start simple, earn complexity with data |

**Where we are actually differentiated is not model sophistication** — Google and Meta will always have more of that. It is in three things nobody else has:

1. **Verified attention** — a checkpoint-and-question mechanism that proves a human watched and understood, rather than inferring it from a viewability pixel.
2. **Observed purchase data** from receipt scanning, rather than inferred intent.
3. **A closed-loop conversion event** — the voucher redemption — that proves the campaign worked, on the merchant's own till.

An advertiser cannot buy any of those three from Meta at any price. That is the moat; the models are just table stakes underneath it.

---

**Cross-references:** [`02-architecture.md`](02-architecture.md) for service boundaries · [`09-points-economy-and-redemption.md`](09-points-economy-and-redemption.md) for pricing and solvency · [`06-longform-video-and-attention.md`](06-longform-video-and-attention.md) for checkpoints and questions · [`14-security-engineering.md`](14-security-engineering.md) for the threat model.
