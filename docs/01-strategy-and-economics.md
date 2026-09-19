# YourTal — Strategy, Currency Model & Unit Economics

**Date:** 2026-09-18
**Read after:** `00-research-summary.md`

---

> **Revision note (2026-09-18, after client context):** campaign videos are **1–30 minutes**, and **the business funds the reward** — points, merchandise, vouchers, or any combination — with points earned at one business redeemable against another's inventory. That changes the economics in §2 materially (for the better) and adds two domains. Read this alongside [`06-longform-video-and-attention.md`](06-longform-video-and-attention.md) and [`07-coalition-clearing-and-commerce.md`](07-coalition-clearing-and-commerce.md).

## 1. The reframe: this is not one product

YourTal as described is **five regulated businesses plus one piece of infrastructure**, wearing one app:

| # | Business | What it really is | Regulator / risk owner |
|---|---|---|---|
| 1 | Ads | A media owner + long-form video platform + measurement vendor | Advertisers, IAB/MRC, privacy law, ad content rules |
| 2 | Points | A **coalition loyalty programme with a clearing house** between partners | Accounting (deferred revenue + breakage), float/trust money |
| 3 | Vouchers, wallet, bidding, cash-out | Stored value + marketplace + payments | BI (ID), ASIC/APRA/AUSTRAC (AU) |
| 4 | **Merchandise** | A marketplace shipping physical goods | Permendag 19/2026 (ID), Australian Consumer Law |
| 5 | Charity | Fundraising | Kemensos PUB (ID), ACNC + state (AU) |
| 6 | YourtalID | An identity provider for the group | Privacy law, security |

Every architectural decision below exists to keep these **separable** — different release cadences, different blast radii, different legal entities, and the ability to switch one off in one country without killing the platform.

## 2. The economics that decide the product

> **⚠️ §2.1 and §2.2 below analyse the *ad-network CPM* model. With the confirmed model — direct-sold long-form video, priced against CAC, with rewards funded from the business's own inventory — the conclusion changes. §2.5 carries the corrected picture. The CPM analysis is retained because it still governs programmatic backfill, and because it explains *why* the business-funded model is the right one.**

### 2.1 What an ad view is actually worth

| | Australia | Indonesia |
|---|---|---|
| Rewarded video eCPM | **$18.87** (AU Android is #1 globally) | ~$0.80–$2.00 (tier-3, to validate) |
| Value of **one** completed view | ~$0.019 | ~IDR 20–32 |
| 10 views/day, 30 days | **$5.66 / user / month** | **IDR 6,000–9,600 (~$0.40)** |
| Reward pool at 40% payout | **$2.26 / user / month** | **IDR 2,400–3,800 (~$0.16)** |

**Read that Indonesia column again.** A heavy Indonesian user grinding ten ads a day for a month earns a reward pool worth *less than a bottle of water*. **Rewarded video CPM cannot fund a compelling reward in Indonesia.** Any plan that assumes "user watches ads → gets meaningful money" fails on arithmetic in the proof-of-concept market.

### 2.2 Where the money actually is

| Action | Indicative eCPM / payout | Ratio vs. video |
|---|---|---|
| Rewarded video | $10–20 | 1x |
| Survey completion (routed to panel) | $0.50–$2.00 **per completion** ≈ $500–2,000 eCPM | **25–100x** |
| Offerwall / CPA (install, signup, first purchase) | ~$400 avg eCPM, up to $1,500 | **20–75x** |
| Direct-sold brand campaign w/ merchant-funded voucher | merchant's *marginal cost*, not their cash | **see below** |

**Strategic conclusion #1 — video is the engagement surface, not the revenue engine.** Video keeps the user in the app and is what brands recognise and buy. **Surveys, offers and direct-sold campaigns pay for the rewards.** The product must make it natural to slide from "watch" → "answer 4 questions" → "try this offer" without it feeling like a job.

### 2.3 The insight that makes Indonesia work: the voucher *is* the ad currency

A restaurant with 70% gross margin can fund a voucher with **IDR 50,000 face value** at a **real cost of IDR 15,000**, and only pays it when a customer actually walks in and spends IDR 100,000. To that merchant, giving away 1,000 vouchers is a **IDR 15 M customer-acquisition spend with guaranteed footfall** — and it is far easier to approve than a IDR 50 M cash media buy.

To the user, that voucher is worth IDR 50,000 — which is **~15x** the entire monthly reward pool that video CPM could have funded.

So the deal we sell in Indonesia is:

```
Merchant pays:   [small cash for reach]  +  [voucher inventory at COGS]
User receives:   entertainment + points  ->  vouchers worth 10-50x the CPM value
Platform keeps:  the cash, a cut of voucher redemption, and the data
Merchant gets:   measurable footfall, new customers, and a cheaper CAC than Meta
```

**Strategic conclusion #2 — reward users in partner-funded inventory, not in cash-equivalent points funded by CPM.** This is the difference between a business and a subsidy.

### 2.4 Rough scale-to-viability (assumptions, to be validated)

| | Indonesia | Australia |
|---|---|---|
| Gross revenue / active user / month | ~$0.55 — **unevidenced, see note** | ~$9.50 — same caveat |
| Reward payout ratio | 40% | 40% |
| Contribution / user / month | ~$0.33 | ~$5.70 |
| Active users for $250k/mo contribution | **~750,000** | **~44,000** |

> **These figures are now suspect.** Prodege — a *surviving* US rewards platform at scale — earns roughly **$2.50 per registered member per year**. The Indonesian assumption above implies **$6.60/year**, i.e. 2.6x what a mature survivor achieves in a far richer market. Rebuild this table from pilot data before it reaches an investor deck. See [`21-failed-analogues.md`](21-failed-analogues.md).

Indonesia needs roughly **17x the users** of Australia for the same money. That is exactly the right shape for the stated plan — *cheap users to prove the mechanic, expensive users to bank it* — but it must be stated out loud, because it means **Indonesia is an R&D market with a marketing budget, not a profit centre**, and the business plan should not pretend otherwise.

### 2.5 The corrected picture: we are not selling impressions, we are selling CAC

§2.1–2.4 assume we are price-takers in an ad-network CPM market. **We are not.** The confirmed model is:

- the business uploads **1–30 minutes** of their own content,
- the business **funds the reward** themselves (points, vouchers, merchandise, or a mix),
- the user watches, **answers the business's questions**, and earns,
- YourTal charges a cash fee and clears the points between partners.

That is not an impression. It is **a qualified prospect who gave 20 minutes of verified attention, demonstrated recall, and now holds a voucher that requires a store visit to realise.** It must be priced against **customer acquisition cost**, not CPM.

**Illustrative Indonesian deal, 30-minute campaign:**

| Line | Amount |
|---|---|
| Voucher face value to the user | IDR 50,000 |
| Real cost to the business (70% margin) | IDR 15,000 |
| YourTal cash fee per **verified completed view** | IDR 10,000 |
| **Business cost per engaged, verified prospect** | **IDR 25,000 (~$1.56)** |
| YourTal delivery cost (Cloudflare Stream, 30 min) | ~IDR 480 |
| **YourTal gross margin per view** | **~IDR 9,500** |

Indonesian Meta/Google CAC for a considered purchase commonly runs **IDR 50,000–200,000** — and buys a click, not thirty minutes and a measured recall score. At IDR 25,000 we are cheaper *and* the voucher redemption is itself the conversion event, which is exactly the measurement Meta cannot sell them.

**So the ranking in §2.2 changes.** Direct-sold long-form moves from a complement to **the primary revenue engine**. Surveys and CPA offers remain excellent supplementary revenue — and the checkpoint questions make survey delivery nearly free — but they are no longer the thing holding the model up.

**The risk moves with it.** The model now rests on two testable assumptions:

1. **Will users watch 1–30 minutes for a voucher?** (The reward must beat their data cost by ~20x — see [`06`](06-longform-video-and-attention.md) §2.3. A IDR 50,000 voucher against IDR 720 of data clears that easily; points worth IDR 2,000 would not.)
2. **Will businesses pay per completed view at CAC-level prices?**

Both can be tested with a manual pilot — a landing page, a hosted video, a Google Form, ten merchants — in **weeks**, before a line of decisioning code exists. **Do that first.**

## 3. The three-currency model (the core design)

This is the single most important piece of design in the platform. Get it wrong and the product is an unlicensed payments business in two countries.

```
        EARN                     CONVERT                    EXIT
  +---------------+        +----------------+        +------------------+
  |  YourTal      |        |   Voucher      |        |   Cash wallet    |
  |  Points (YTP) | -----> |   (entitlement)| =====> |   (AUD / IDR)    |
  +---------------+   burn +----------------+  sell  +------------------+
   non-monetary             merchant-issued          real money
   non-transferable         has face value           real regulation
   expires                  transferable ONLY
   NEVER buyable            via platform escrow
   NEVER cash-redeemable    (void old, mint new)

  <====== there is NO arrow back from cash to points ======
```

**Rules that must never be violated:**

1. **Users cannot buy points with money.** The moment they can, points are prepaid value and this is a payments business.
   **Businesses can and must** — a partner pre-purchases points at a wholesale rate to give away as campaign rewards. That is the coalition funding model (see [`07`](07-coalition-clearing-and-commerce.md) §2) and it is B2B, not consumer stored value. Keep the two paths architecturally distinct and never let a consumer-facing surface expose a purchase price per point.
2. **Points have no fixed, published cash exchange rate.** Their value floats against a reward pool (see §3.1). A guaranteed "1,000 points = IDR 10,000" is what makes a regulator call it e-money.
3. **Points cannot be transferred between users.** Gifting is a fraud vector and a monetary feature.
4. **Points expire** (12–24 months, rolling). Expiry is what makes breakage estimable and caps the liability.
5. **The cash wallet is one-way with respect to points.** Cash enters from advertiser billing and marketplace sales. It never becomes points.
6. **Voucher transfer voids the old code and mints a new one.** This is the lesson of Cardpool and Raise — never let two parties hold the same live code.

### 3.1 Floating point value (rationing, not promising)

Do not price a point in currency. Price **vouchers in points**, and adjust prices so the available reward pool clears:

```
reward_pool(period) = cash_ad_revenue x payout_ratio
                    + merchant_funded_voucher_face_value
                    + sister_app_funded_inventory

voucher_price_in_points = f(face_value, scarcity, demand, user_tier)
```

Users experience this as "prices in the rewards store move, like any shop." Legally it is decisive: there is no fixed monetary claim. Operationally it means we can never be insolvent in points.

### 3.2 The fork in the road: cash-out

The brief says vouchers can be **sold via bidding**, and that charity donation works by **selling the voucher and transferring the proceeds**. That creates a path:

```
points -> voucher -> auction sale -> money
```

which is functionally a redemption of points for cash, however indirect. There are three ways to build it, and **this is the single biggest decision on the roadmap**:

| Option | What users can do with sale proceeds | Regulatory consequence |
|---|---|---|
| **A — Closed loop** | Buy other vouchers, or donate to charity. No withdrawal. | Lightest. Arguably still a loyalty programme. Fastest to launch. |
| **B — Charity-only exit** | Proceeds leave only to a registered charity partner (who holds the fundraising permits). | Light, but needs a charity partner and clean settlement accounting. |
| **C — Full cash-out** | Withdraw to bank / e-wallet. | **Heavy.** AU: likely a non-cash-payment facility → AFSL or relief, AUSTRAC registration, APRA if >$200M stored. ID: PJP licensing under BI Reg 10/2025, PT PMA with ≥15% local ownership, IDR 15 bn capital, local director. |

**Recommendation: launch on A, add B in phase 3, treat C as a separate licensed subsidiary with its own business case and a 12–18 month lead time.** Build the ledger and wallet so that C is a configuration change plus a licence, not a rewrite.

## 4. Revenue streams, ranked by how soon they can be real

| # | Stream | Phase | Notes |
|---|---|---|---|
| 1 | **Cash fee per verified completed view** on direct-sold campaigns | 1 | The core. Priced against CAC, not CPM. Human sales at first. |
| 1b | **Open View fee** — low per-view rate for anonymous, unrewarded views | 1 |
| 2 | **Clearing spread on points** — issuance price minus redemption price | 1 | Pure margin on every point that moves between partners. See [`07`](07-coalition-clearing-and-commerce.md) §2.1. |
| 3 | **Breakage** on expired points | 2+ | Material (Starbucks: $200.4 M in FY25). Requires an expiry policy from day one. |
| 4 | **Recall / brand-lift reporting** from the end-of-video questions | 2 | A product Meta cannot sell. Should be a paid tier, not a freebie. |
| 5 | Survey routing (Cint, Prodege/Pollfish, Toluna, Lucid) | 2 | Checkpoint questions make delivery nearly free. Buy supply first, build a panel later. |
| 6 | Offerwall / CPA offers | 2 | Plug in an existing offerwall before building one. |
| 7 | Programmatic backfill for unsold inventory | 2 | Revenue floor only. This is the one stream where §2.1's CPM reality still governs. |
| 8 | Self-serve advertiser platform | 2–3 | Grows advertiser *count*; managed grows account *value*. Need both. |
| 9 | Commerce take rate on merchandise redemption | 3 | Arrives with the physical-goods leg. |
| 10 | Marketplace take rate on voucher bidding | 3 | Only after fraud controls are mature. |
| 11 | Sister-app acquisition fees | 1 | Internal transfer pricing — but it is real value and should be booked. |
| 12 | White-label loyalty for partner merchants | 4 | Optional. Distraction risk. |

## 5. The engagement layer — what to copy and what to avoid

Shopee/Tokopedia-style gamification works on six elements: **social interaction, sense of control, goals, progress tracking, rewards, prompts**. The research shows measurable engagement lift in exactly the Indonesian market we are targeting.

**But:** in Indonesia, anything where the outcome is determined by chance and a prize is at stake is a **prize draw under Ministry of Social Affairs Reg. 3/2024** — it needs a draw permit *and* a promotion permit, plus a **compulsory 10% of total prize value contributed to social welfare**. Prediction games are prohibited outright, *even when free*. See `03-regulatory-and-risk.md`.

**Design rule: make every game skill-based or deterministic, not random.** Not because random is impossible, but because skill-based games need no permit in either country and can ship on a weekly cadence instead of a per-campaign permit cycle. Reserve permitted, licensed prize draws for a handful of big tentpole campaigns per year where the marketing value justifies the paperwork.

Safe-by-design mechanics that still feel like Shopee:
- **Streaks and daily check-in** — deterministic, escalating, no chance element.
- **Progress bars / collect-the-set** (Shopee Tanam style) — the reward is earned by completing tasks, not drawn.
- **Skill mini-games** — reaction, puzzle, memory, trivia with a correct answer. Outcome determined by skill → no permit in AU, no prize-draw exposure in ID.
- **Tiered status** — deterministic thresholds.
- **Leaderboards with skill-ranked prizes.**

Avoid at launch: spin-the-wheel, mystery boxes, scratch cards, lucky draws, loot boxes, any prediction/guessing game.

## 6. Surveys without the word "survey"

The brief asks for paid surveys **masked as regular questions** to cut bounce. The engagement design is right — one question at a time, in-feed, contextual, 5–10 seconds each, no 30-question wall. This is how every good in-app survey product works.

**Where the line is:** you may make surveys *pleasant and incremental*; you may not make them *undisclosed*. Both ID's PDP Law and AU's Privacy Act require the purpose of collection to be disclosed before consent. ESOMAR codes — which every real survey buyer checks — require respondents to know they are in research. Selling answers gathered from people who were not told they were answering a market-research question is the kind of thing that ends a platform.

**The design that satisfies both:** a persistent, honest, low-friction frame — e.g. *"Quick questions. Brands pay for your answers. You can skip any of them."* — shown once, plus a small recurring badge on question cards. Then deliver the questions one at a time, in feed, conversationally. The user gets the un-overwhelming experience; the platform gets defensible consent and sellable, ESOMAR-compliant data.

**Update — the business's own questions are now the primary surface.** Businesses author questions shown at the end of (and during) their video, gating the reward. That is a *fair and disclosed trade*: the user knows from the campaign card that answering is the price of the voucher. It is also strictly better than a masked survey, because:

- it is **honest by construction** — nobody is tricked into research,
- it **verifies attention**, which is what makes the reward defensible against fraud,
- it produces **recall and comprehension data the business will pay extra for**,
- and the *same* delivery mechanism can carry paid third-party survey questions later, with their own disclosure.

Two questions are now distinct and must stay distinct in the data model: **campaign questions** (the business's, gating the reward, disclosed as part of the deal) and **research questions** (sold to a panel buyer, requiring research disclosure and separate consent). Never let the second hide inside the first. Design in [`06`](06-longform-video-and-attention.md) §4.

## 7. The "Netflix architecture" question — answered (revised)

**Still no Netflix.** But with 1–30 minute business-uploaded video, the right reference becomes **YouTube**, and half the machinery comes back.

| | Netflix's problem | **YouTube's problem** | YourTal |
|---|---|---|---|
| Content | Curated, few, professional | Uploaded by anyone, constantly | **Uploaded by every advertiser** |
| Access | Hot catalogue, caches perfectly | Long tail, most assets rarely watched | **Long tail — most campaigns are small and local** |
| Hard cost | Delivery of hits | **Storage + encode of the tail** | **Storage + encode of the tail** |
| Hard problem | Rebuffer on a 2-hour film | **Moderation at upload volume** | **Moderation + brand safety + ad-claims compliance** |

We still do not need Open Connect appliances, per-shot encoding or a custom CDN. We **do** now need an upload → moderate → encode → lifecycle pipeline, a cold-storage policy for the tail, and genuine cost control — none of which a world of 30-second creatives would have required.

And one constraint that has no analogue at Netflix or YouTube: **the user's own data bill.** A 30-minute view at 800 kbps costs an Indonesian user ~180 MB, around IDR 720 — a real fraction of a IDR 50,000–100,000 monthly data budget. Default to 360–480p, show the data cost before playback, offer download-on-Wi-Fi, and treat telco zero-rating as a genuine partnerships play.

Full design in [`06-longform-video-and-attention.md`](06-longform-video-and-attention.md).

## 8. Blockchain — where it earns its place, and where it does not

**Not for the points ledger.** A hash-chained, append-only Postgres ledger with signed daily Merkle roots gives tamper-evidence and auditability with none of the cost, latency or regulatory surface.

**Not for voucher issuance in phase 1.** Ed25519-signed voucher tokens already give unforgeable, offline-verifiable redemption artefacts.

**Where it might genuinely pay later:**
- **Multi-party settlement** when sister companies and external merchants need a shared, mutually-trusted record of who owes whom for redeemed vouchers — the consortium case, which is the one honest use.
- **Cross-border voucher portability** between ID and AU entities.
- **Public proof-of-fairness** for auctions and prize draws (publishing a verifiable commit-reveal seed) — this is achievable with plain cryptography, no chain needed.

**Recommendation:** design the voucher as a signed, transferable token with an abstract custody backend. Keep phase 1 custody in Postgres. If and when a consortium partner demands it, swap in a chain without touching the domain model. Do not put "blockchain" on the roadmap as a goal — put *"voucher custody is pluggable"* on the roadmap as a property.

## 9. AI — where it earns its place

| Use | Phase | Value |
|---|---|---|
| **Fraud / anomaly detection** on reward events | 1 | Existential. Highest ROI AI in the platform. |
| **Ad ranking** (pCTR/pCVR, two-tower retrieval) | 2 | Directly converts into eCPM. |
| **Interest inference** from sister-app signals (receipt scans are gold) | 2 | Our defensible data moat vs. Meta/Google. |
| **Creative QA & policy screening** (LLM) on advertiser uploads | 2 | Makes self-serve safe to open. |
| **Advertiser copilot** — "describe your campaign" → targeting + budget + creative brief | 3 | The SMB self-serve unlock. |
| **Survey question generation & response quality scoring** | 3 | Panel quality, ESOMAR defensibility. |
| **Support / dispute triage** | 3 | Cost. |

**The moat:** snap-apps receipt scanning gives *verified real-world purchase data* — what someone actually bought, where, and for how much. Meta infers that; we would observe it. That is the most valuable targeting signal in the platform and the reason the sister-app strategy is more than cross-promotion. It is also the most privacy-sensitive data in the platform and must be consented, minimised and aggregated deliberately (see `03-regulatory-and-risk.md`).
