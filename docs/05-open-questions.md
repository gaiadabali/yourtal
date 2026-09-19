# YourTal — Open Questions

**Date:** 2026-09-18
**Purpose:** convert the plan into an executable backlog. Answers to the 🚩 questions change the architecture; the rest change the sequence or the sizing.

**Resolved by client context added 2026-09-18:** A3 (the business funds the reward), A7 (1–30 minute video), G3 (web app / PWA), and the reward is **always points** with all inventory pooled in one store. New questions arising are in **sections J and K**.

---

## A. Business model & scope

**A1 🚩 Cash-out: which option?**
The brief lets users sell vouchers by bidding and donate proceeds to charity — both of which imply money leaving the system. Pick one:
- **(A) Closed loop** — sale proceeds can only buy other vouchers. Ship in phase 3, minimal licensing.
- **(B) Charity-only exit** — proceeds leave only to a registered partner charity.
- **(C) Full cash-out to bank/e-wallet** — needs AFSL/relief + AUSTRAC in AU and PJP licensing (or a licensed partner) in ID; 12–18 month lead, material capital.
*This single answer determines whether we are building a loyalty programme or a payments company.*

**A2 🚩 What does the business pay YourTal, concretely?**
The business funds the *reward*. Separately, what do they pay *us*? A cash fee per verified completed view (recommended — it prices against CAC), a percentage of voucher face value, a monthly subscription, a clearing spread on points, or a combination? What does a first merchant contract actually look like?

**A3 ✅ RESOLVED — the business funds the reward, and the reward is always points.** Vouchers and merchandise are *inventory* the business supplies to the shared store, priced in points — a separate relationship from funding a campaign. **The funding mechanism (J1) and the pricing model (K1) are still open.**

**A4** Is there a committed launch merchant list? How many, in which categories (F&B, retail, telco, e-commerce)? Warm or cold?

**A5** Is YourTal a *closed* network (only sister companies + direct merchants) or does it eventually accept programmatic demand from external DSPs? That changes whether we implement OpenRTB.

**A6** Revenue target and runway: what does year 1 have to produce, and what is the funding envelope? This decides build-vs-buy on almost every line.

**A7 ✅ RESOLVED — 1–30 minute business-uploaded video.** The reference architecture becomes YouTube's (upload volume, long tail, moderation, storage lifecycle), not Netflix's. See [`06-longform-video-and-attention.md`](06-longform-video-and-attention.md).

---

## B. Currency & value model

**B1 🚩 Is a fixed points-to-currency rate a requirement?**
The plan recommends **no published fixed rate** on the consumer side — prices are computed from a platform-set backing rate `B` that is never shown to users — specifically to stay out of e-money regulation. Note this now sits in tension with the B2B side, where partners *must* have a per-point price to fund campaigns. The two prices must not be the same number, and the consumer surface must never display one. Does the business need "1,000 points = IDR X" for marketing reasons? If yes, get a legal opinion before writing code.

**B2** Users cannot buy points — confirmed as a rule. Businesses must be able to. Is that distinction understood and accepted by the commercial team?

**B3** Can **points** be transferred between users? (Recommendation: never — note **vouchers** are transferable, one hop, under K8.)

**B4** What is the points expiry policy? 12 months rolling, 24 months, tier-dependent? This directly sets breakage revenue and the size of the liability on the balance sheet.

**B5** Do points earned in snap-apps have the same value as points earned watching a campaign, or do we need separate point types / earning pools per source?

**B6** Are points country-scoped? (Recommendation: yes — an Indonesian user's points cannot be spent in Australia and cannot migrate. Two coalitions, two clearing houses, one codebase.)

**B7** Holdback: how long between earning points and being able to burn them into a voucher? On web the recommendation rises to **72 h for new accounts**, decaying with trust, because we lost attestation. Acceptable?

**B8** Who bears the loss when a voucher is honoured but later found fraudulent — YourTal, the merchant, or the user's balance is clawed back? Must be in the merchant contract before phase 1.

---

## C. Users & supply

**C1** Launch geography inside Indonesia: Jakarta-only, Jabodetabek, or national? Merchant density decides whether the reward store feels full or empty.

**C2** Target user: who is the phase-1 Indonesian user? (Students, gig workers, young families, deal-hunters?) This drives the reward mix, the game design and the tolerance for a 20-minute video.

**C3** Acquisition plan: is YourTal acquiring users itself, or is it seeded entirely from the sister apps' existing bases? What are those bases today — actual MAU for snap-apps, freetaxreturns, uniqueweightloss, humanspedia?

**C4** Minimum age, and is there any under-18 experience? Children's advertising rules and the AU privacy reform's child-protection provisions make this a design decision, not a T&C line.

**C5** What is an acceptable fraud loss, as a percentage of reward value issued? Industry-tolerable is usually 1–3%. **On web, budget higher** — see J15.

**C6** KYC: is any identity verification acceptable to users at any tier? Even closed-loop, a verified-identity tier dramatically reduces multi-accounting.

---

## D. Advertisers & demand

**D1** Who sells? Is there a sales team, or must self-serve carry the load from day one? Research is clear that *self-serve grows advertiser count and managed service grows account value* — every network that scaled did both, but not simultaneously.

**D2** Minimum spend / minimum campaign size at launch?

**D3** What targeting do businesses actually ask for? (Demographics, location, declared interest, purchase history from receipts, lookalikes, retargeting?) Purchase history is our moat but also our biggest privacy exposure — worth the compliance work in phase 2, or later?

**D4** What reporting do businesses need to believe the spend worked? Impressions and completion, or **recall score, drop-off curve and voucher-redemption attribution**? The latter set is our differentiator versus Meta and should probably be the headline product.

**D5** Are businesses required to fund rewards, or is a cash-only campaign (no reward attached) also on the menu?

**D6** Do we guarantee delivery (fixed completed views for a fixed price) or is everything priced per delivered outcome? Guaranteed delivery makes pacing a contractual obligation and needs forecasting from day one — and forecasting completions on a 30-minute video is much harder than forecasting impressions.

---

## E. Engagement, games & surveys

**E1 🚩 Confirm: skill-based games only at launch?**
In Indonesia, chance-based prize mechanics need MOSA draw + promotion permits and a 10% social-welfare contribution, and prediction games are prohibited even when free. In Australia they need state permits above $3k–$10k prize pools. The recommendation is skill/deterministic mechanics only, with permitted draws reserved for 2–4 tentpoles a year. Does the business accept that constraint?

**E2** Which Shopee/Tokopedia mechanics matter most — daily check-in streaks, collect-the-set progress (Tanam-style), social/referral mechanics, leaderboards, or tiered status? Build 2, not 6.

**E3** Surveys: is the platform routing to external panels (fastest revenue) or building its own first-party panel (better margin, much slower, needs ESOMAR/ISO credibility)?

**E4** Campaign questions (the business's, gating the reward) and research questions (sold to a panel buyer) must stay distinct in the data model and in disclosure. Confirm the business understands that third-party research questions need their own consent and cannot hide inside a campaign quiz.

**E5** Is user-generated or third-party *content* (not campaigns) part of the feed, or is the feed entirely campaigns, questions and quests? A content supply problem is a whole extra product.

---

## F. Sister apps

**F1** Which sister apps are live today, on what stack, and who owns their code? Can they take an SDK integration in the next quarter?

**F2** For each app, what actions should earn points, and what is each action worth to the group? (Is a snap-apps receipt scan worth more than a completed 20-minute watch? By how much?) The Reward Engine needs a value table.

**F3** Who pays for points earned in sister apps — is there internal transfer pricing, or does YourTal absorb the liability as a group marketing cost? Note this is the *same mechanism* as partner funding (J1) pointed inward, and should use the same machinery.

**F4** Does snap-apps receipt data get shared with YourTal for targeting? If yes, under what consent, and can it be aggregated rather than user-level?

**F5** Do sister apps need to *spend* points too (e.g. points pay for a freetaxreturns premium feature), or is YourTal the only place to redeem?

**F6** Is a single shared login mandatory, or must sister apps keep their own accounts with optional linking? Forced migration of existing accounts is a project in itself.

---

## G. Technology & team

**G1 🚩 What is the existing team?** Size, languages they are strong in, and whether they are in-house, in Indonesia, or outsourced. The Go + NestJS + Python split assumes a team that can carry three languages; a smaller team should collapse to TypeScript + Python. Note the web decision makes strong frontend capability non-negotiable.

**G2 🚩 Cloud: GCP or AWS?** Both have Jakarta and Sydney. Existing credits, existing expertise or an existing sister-app footprint should decide it.

**G3 ✅ RESOLVED — web app / PWA**, mobile-first, excellent on tablet and desktop, lightning fast. **The cost must be accepted explicitly: no Play Integrity, no App Attest.** Compensating stack in [`08-web-app-and-performance.md`](08-web-app-and-performance.md) §2.1; Capacitor wrap is the documented escape hatch. **Follow-ups: J15–J18.**

**G4** Is there an existing design system or brand for the group, or does that need building?

**G5** Do sister apps already share any infrastructure (accounts, database, CI, cloud account) that YourTal should reuse or must avoid?

**G6** Is there an appetite to buy an ad server (Kevel/Topsort) for phase 1? *Note: with long-form, business-funded rewards, checkpoint questions and points clearing, the vendor fit is now much worse than it was. Recommendation firms up to **build**.*

**G7** Blockchain: a genuine requirement from an investor/partner, or an option? *Note: the coalition clearing house is the one place where a shared multi-party record has a real argument — see [`07`](07-coalition-clearing-and-commerce.md) §2. Still recommend Postgres with signed statements for phase 1, and keeping voucher custody pluggable.*

---

## H. Legal, entity & compliance

**H1 🚩 What entities exist or are planned in each country?**
Indonesia's PJP path requires a PT with ≥15% Indonesian ownership, a locally domiciled director, and ~IDR 15 bn capital for full scope. Even without a payments licence, a local PT is needed for PSE registration and merchant contracting. What exists today?

**H2** Is there local counsel engaged in Indonesia and Australia? The 🔴 items in [`03`](03-regulatory-and-risk.md) cannot be resolved by engineering.

**H3** Which charity partners are in scope, and are they ACNC-registered (AU) / PUB-permitted (ID)? The recommendation is that YourTal never holds charitable funds.

**H4** Who owns finance/accounting? Points liability, breakage policy, **partner float segregation** and merchant reconciliation need an owner from phase 1 — an auditor engaged late will force a restatement.

**H5** Data residency: is keeping Indonesian data in Jakarta and Australian data in Sydney acceptable, accepting that group reporting only ever sees aggregates? (Recommended, and the cheapest answer to both regimes.)

**H6** Is there a target certification (ISO 27001, SOC 2)? Large advertisers and survey buyers will ask. Far cheaper to build toward than to retrofit.

**H7** Who handles **merchant KYB** — NIB verification and document expiry tracking under Permendag 19/2026 is a hard gate before any merchant lists physical goods, and it is an operations job, not an engineering one.

---

## I. Success criteria

**I1** What does "working" look like at the end of phase 1? Proposed: 10+ paying merchants, ≥20% of issued vouchers redeemed in-store, long-form completion rate above target, 30-day retention above target, fraud loss within budget, CWV budgets met in the field, 60 days of clean reconciliation. Are those the right numbers?

**I2** What is the single metric the business will be judged on in year 1 — users, advertiser revenue, voucher redemption value, or sister-app growth? Everything else should be optimised in service of it.

**I3** Which is the real launch market? The plan assumes **prove in Indonesia, monetise in Australia**. If Australia is actually the priority, phases 1 and 3 swap: the economics get easier, the compliance work arrives immediately.

---

## J. New questions from the added context

### Reward funding & clearing

**J1 🚩 How does a business fund the points it gives away?**
- **(A) Pre-purchase** — buys a block of points upfront at a wholesale rate, drawn down as awarded. Liability transfers to them at purchase; cash is in the door; a partner going bust leaves us nothing unfunded to honour. **Recommended for launch.**
- **(B) Post-paid** — invoiced monthly for points issued. Easier to sell, but we carry credit risk on every point awarded before payment clears.

*This is the difference between running a clearing house and running an unsecured lending book.*

**J2** What are the **two prices** — what a business pays per point issued, and what we pay a business per point redeemed against their inventory? The spread is a primary revenue line and needs a number, not a principle.

**J3** Who keeps **breakage** on expired points — YourTal, or shared with the funding partner? Large partners will negotiate; decide the default now.

**J4** Can a business restrict where its points are spent ("my points, my stores only"), or are all points fully fungible across the coalition? Fungibility *is* the value proposition; restrictions are what some partners will demand. Pick a default and price the exception.

**J5** What happens when a business leaves the coalition with points outstanding — buy-back at redemption price, honour until expiry, or accelerated expiry? Must be in the partner contract from the first signature.

### Merchandise

**J6 🚩 Merchant-fulfilled or platform-fulfilled?**
Recommendation: **the merchant ships; YourTal never holds inventory** — and **start with digital goods** (pulsa/data top-ups, e-vouchers, game credits, subscriptions), which need no logistics at all and fill the rewards store immediately while the physical pipeline is built.

**J7** Who bears non-delivery, damage and returns — and is YourTal prepared to enforce that against merchants (SLA scoring, delisting, settlement holds)? Note Australian Consumer Law guarantees apply to goods **even when paid for in points**.

**J8** Is merchandise redeemable with **points only**, or points + cash top-up? A top-up option massively widens the catalogue but introduces a consumer payment flow earlier than planned.

### Video & questions

**J9** What is the realistic **length distribution**? The plan expects 1–5 minutes to carry most inventory, with 15–30 minute features as the differentiator. If most campaigns really are 30 minutes, completion rate becomes the single make-or-break metric and the pilot in phase −1 matters even more.

**J10 🚩 Scoring policy: hard pass/fail, or completion reward + accuracy bonus?**
Strong recommendation: **gate on *answering*, scale on *correctness*.** Failing someone out after 28 minutes is where you lose the user permanently and earn the reviews that kill web-app acquisition. Businesses who want a hard threshold can have one — disclosed on the campaign card before the watch begins, with at least one retry.

**J11** How many questions may a business ask, and is the platform willing to **refuse** a campaign that asks too many or tries to harvest personal data through them? (It must be. Businesses will try to turn the quiz into a lead form.)

**J12** Can a user **re-watch and re-answer** for a better score, or is it one attempt per campaign?

**J13** Do businesses get **per-user answers** or only aggregates? Aggregates-only is the correct and defensible answer in both jurisdictions — confirm the commercial team accepts it, because some advertisers will ask for the raw file.

**J14** Is **telco zero-rating** in Indonesia worth a partnerships workstream? It removes the biggest objection to long-form in the proof-of-concept market, and there is precedent (Telkomsel VideoMax and the broader telco–streamer co-opetition model).

### Web app

**J15 🚩 Is the loss of native attestation accepted?**
Web means no Play Integrity and no App Attest — the strongest single anti-farm control is gone, at exactly the moment rewards become voucher-scale. The compensating stack ([`08`](08-web-app-and-performance.md) §2.1) is good but weaker. **Is the business prepared to accept a higher fraud-loss budget in exchange for web distribution, and to ship a Capacitor wrap if losses exceed ~3% of reward value issued?**

**J16** Is **mandatory phone verification** acceptable at signup? It is the strongest control we have left, and unusually effective in Indonesia because SIM registration is NIK/KK-bound with per-NIK limits. It also costs signup conversion.

**J17** Confirm the **performance target**: mid-tier Android over 4G in Jakarta, LCP ≤ 2.0 s, INP ≤ 200 ms, initial JS ≤ 170 KB, enforced in CI and monitored with RUM segmented by country and device class.

**J18** Is a **Capacitor wrap / Play Store listing** acceptable later, or is web-only a permanent product decision? This changes how device-signal collection is abstracted today — and abstracting it costs nothing now.

---

## K. The points economy (from the "reward is always points" clarification)

### Pricing & monetary policy

**K1 🚩 Confirm the pricing model: suppliers declare a settlement value, YourTal computes the points price.**
If suppliers set point prices directly, any business can underprice and drain the platform's margin — this is not a hypothetical, it is the default outcome. The proposal is `points_price = (S / B) × demand_multiplier`, where the supplier controls `S` (their subsidy) and YourTal controls `B` (the backing rate). The **per-business exchange rate you want emerges naturally from different subsidy levels**, and no supplier can price us into a loss. Full derivation in [`09`](09-points-economy-and-redemption.md) §4. Is this acceptable to the commercial team, and can it be sold to merchants?

**K2 🚩 What are the two opening numbers — `P_issue` (what a business pays per point) and `B` (the value we commit to deliver per point)?** The gap is the platform's structural margin. A 25% spread (IDR 8 / IDR 6) is the worked example; the real numbers are a commercial decision.

**K3** Is **dynamic pricing** acceptable at all — prices moving with demand within a bounded range? The hotel-industry precedent shows *more consistent* per-point value, not merely cheaper. If the answer is no, prices are static and the economy loses its main self-correcting lever.

**K4** What happens when the economy needs to be **devalued** (`B` reduced, all prices up)? Is the business willing to announce it rather than do it silently? Silent devaluation is the fastest way to lose a points community.

**K5** **Who owns the economy?** This needs a named analyst or economist watching issuance vs. redemption, coverage ratio and catalogue depth daily. It is a role, not a feature. Does that person exist or need hiring?

### Solvency

**K6 🚩 Will every unfunded point be backed by a real cash transfer into the reserve at the moment of issuance?**
Points from sister-app actions, referrals, streaks and promos have no business paying for them. If they are simply minted, the platform is printing money against a liability it cannot cover — and the failure is silent until the store empties. The rule is two ledger entries. Is finance prepared to enforce it with no exceptions?

**K7** What coverage ratio triggers what action — alert, stop promos, stop unfunded issuance, reprice?

### Vouchers & transfer

**K8** Confirm **one-hop transfer only** (User B → User C, but C cannot pass to D), to a **verified YourTal user**, with a holdback and velocity caps. This preserves gifting — which is what users actually want — while stopping vouchers becoming a circulating currency. 🔴 Counsel must review the transfer design specifically; it moves us closer to the stored-value line than the original non-transferable design.

**K9** **Partial redemption:** when a IDR 50,000 voucher meets a IDR 30,000 order, does the balance carry (gift-card behaviour) or is it forfeited (coupon behaviour)? Proposal: per-batch flag set by the supplier, **displayed prominently before the user spends their points.**

**K10** Do vouchers expire separately from points, and who bears an expired-but-funded voucher — supplier or platform?

### Merchant redemption

**K11 🚩 Is API integration going to be required of merchants, or optional?**
Strong recommendation: **optional.** A manual merchant-portal redemption path (staff type the code, get a confirmation, apply a manual discount) must exist from day one, because integration will be the reason most SMB merchants say no. The ladder is: manual portal → in-store QR → hosted checkout widget → Shopify/WooCommerce plugin → direct API.

**K12** What share of target merchants are on **Shopify or WooCommerce**? If it is most of them, the plugins are the highest-leverage engineering in phase 2 — note Shopify has no native support for third-party gift-card rewards, so an app is mandatory, not optional.

**K13** Who is liable if a merchant's checkout **fails to honour** a validly redeemed voucher — and what does the user get in the meantime? This is the worst failure in the product because it happens at the moment of maximum expectation. Propose: instant points refund to the user, recovered from the merchant at settlement.

**K14** Are merchants willing to accept a **settlement hold** across the dispute window? It is the control that stops a compromised merchant key becoming irreversible cash.

**K15** Can a voucher be used **partially online and partially in store**, or is each voucher bound to one channel at issuance?

---

## The blocking questions, in one list

**Unchanged and still blocking:**

1. **A1** — Cash-out: closed loop, charity-only exit, or full withdrawal?
2. **A2** — What does the business pay *us*, on top of funding the reward?
3. **B1** — Fixed points-to-currency rate on the consumer side, or floating?
4. **E1** — Skill-based games only at launch?
5. **G1** — What team do we actually have?
6. **G2** — GCP or AWS?
7. **H1** — What legal entities exist in ID and AU today?

**New, from the added context:**

8. **J1** — Do businesses **pre-purchase** points, or are they invoiced after the fact?
9. **J6** — Merchant-fulfilled merchandise, and do we start with digital goods?
10. **J10** — Hard pass/fail on the questions, or completion reward + accuracy bonus?
11. **J15** — Is the loss of native attestation accepted, with a higher fraud budget and a Capacitor escape hatch?

**New, from the points-economy clarification:**

12. **K1** — Suppliers declare a settlement value; **YourTal computes the points price**. Accepted?
13. **K2** — Opening numbers for `P_issue` and `B` (the platform's structural margin).
14. **K6** — Will every unfunded point be backed by real cash into the reserve at issuance?
15. **K11** — Is merchant API integration optional, with a manual portal path from day one?

**Resolved by the added context:** A3, A7, G3.
