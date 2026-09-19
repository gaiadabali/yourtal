# YourTal — What Is Wrong With This Plan

**Date:** 2026-09-19
**Written at the founder's request:** _"show me my weakness as truth so we can patch our plan."_

This is deliberately unbalanced toward problems. The plan's strengths are documented everywhere else. Ordered by how badly each could hurt you.

---

## Tier 1 — Could kill the business

### 1.0 Four of the fraud controls do not exist — **confirmed, not suspected**

The audit in [`22-assumption-audit.md`](22-assumption-audit.md) verified the web fraud model and **four of its five pillars fail**:

| Claimed control                           | Reality                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CDN segment-log cross-check               | Cloudflare Stream exposes **no per-session or per-segment data**. It also bills preload as delivery, so "delivered" never meant "watched"                        |
| Indonesian SIM/NIK as an expensive anchor | ~9 self-service SIMs per NIK; grey market at Rp25–100k; OTP rental at USD 0.01–0.10. **Cents per account**                                                       |
| Passkeys as device binding                | Synced by default, no attestation from Safari or GPM, `devicePubKey` dropped from WebAuthn L3, DevTools ships a scriptable virtual authenticator. **$0 for 500** |
| Wake Lock + Page Visibility               | Spec-mandated to release when hidden; no browser fires on app-switcher; defeated by two lines of JavaScript                                                      |

**Total attacker cost to run 500 accounts: under $150.** Every one failed the same way — _pre-auth, per-session checks against a post-auth, cross-account problem._

This does not kill the business; rewards platforms all live with farming. It does mean **the 2% fraud-loss budget is fiction**, the defence must move to post-earn vesting and cross-account detection, and the reward mix must be trust-tiered. Rewritten in [`08`](08-web-app-and-performance.md) §2.1a.

**It also flips the video decision:** self-hosted HLS on R2 is both ~100× cheaper on delivery _and_ the only route to a working attention check. Stream is now pilot-only.

### 1.0b Plenti — Amex built your coalition and it died in three years

[`21-failed-analogues.md`](21-failed-analogues.md) found the precedent I should have found before writing doc 07. **Plenti** was American Express's US coalition: earn at merchant A, spend at merchant B, one pooled store. Exactly our clearing house.

It launched in 2015 and was dead by 2018, for a structural reason rather than an operational one: **points accrued cheaply at high-traffic staples and were redeemed at premium merchants who got footfall they never funded.** Macy's called the value flow "asymmetrical" and said it did not drive new traffic into stores.

Our mechanics differ — a funding business buys attention, not traffic, and the redeeming business is _paid_ settlement value — but **the perception is identical and fatal in the same way**: a merchant who funds IDR 8M of points will watch them spent at the coffee shop next door and conclude they subsidised a competitor. A rational merchant then prefers to hand out their own voucher directly, with no coalition at all.

**If Amex could not make this work in the world's richest market, the pooled store is the plan's single largest structural risk — not an implementation detail.** It is also, note, exactly what the cheaper plan at the end of this document defers.

**Patch:** if the coalition survives review, every funding business must see attribution — _"your points bought N views and M of your own vouchers redeemed"_ — and campaign rewards should bias toward the funder's own inventory. Full fungibility (decision J4) is now questionable.

### 1.1 The format contradiction: the customers who suit the economics cannot make the content

This is the sharpest problem in the plan and nothing currently addresses it.

|                                                        | Who the **voucher economics** work for        | Who the **1–30 min video format** works for             |
| ------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------- |
| Profile                                                | SMB, high gross margin, local, needs footfall | Brand with a marketing budget and a content team        |
| Example                                                | A coffee shop, a salon, a warung              | A bank, a property developer, a university, a car brand |
| Content they have                                      | A 30-second phone video, badly lit            | A professional 15-minute explainer                      |
| Can they fund a IDR 50,000 voucher at IDR 15,000 cost? | **Yes, easily**                               | Often no — low margin or no retail product              |

**These are two different customers, and the plan assumes they are one.** A coffee shop cannot produce twenty watchable minutes and never will. A bank can, but has no voucher to give.

Three ways out, and one has to be chosen before Phase 1 scope is fixed:

1. **Two products.** Short-form (30–180 s) for SMBs with vouchers; long-form for brands paying cash. Doubles the surface area.
2. **Production as a service.** YourTal shoots the video. A real revenue line, but it is an agency business with agency margins and agency scaling problems.
3. **Accept SMB content will be bad** and design for 60–180 seconds as the default, treating 15–30 minutes as a rare brand format. **This is the cheapest and most likely correct answer**, and it means the CAC pricing in [`01`](01-strategy-and-economics.md) §2.5 — which assumes thirty minutes of attention — needs rebuilding around three minutes.

### 1.1b The survivor rule: nobody who sells attention survives

The clearest finding in [`21`](21-failed-analogues.md). Every failure in this category paid a **fixed cost per view against variable revenue**. Every survivor — Prodege, Mistplay, Fetch — sells **permissioned data and measurable actions**, and funds the reward from **a share of a transaction that only exists because someone bought something**. Variable cost against variable revenue.

|                  | Failures (Viggle, Perk, BAT) | Survivors (Prodege, Mistplay, Fetch) |
| ---------------- | ---------------------------- | ------------------------------------ |
| What is sold     | Attention                    | Data and measurable actions          |
| Reward funded by | A fixed payment per view     | A share of a real transaction        |
| Cost structure   | Fixed cost, variable revenue | Variable cost, variable revenue      |

**Viggle is the closest operational precedent and the bleakest:** $25.6M revenue against a **$78.5M net loss** in its best year, roughly $367M accumulated deficit, 9.5M registered users, a going-concern opinion, and an eventual sale for about $4.7M — **$0.49 per registered user.** Its only cost improvement came from re-estimating points breakage.

**Where YourTal sits:** we charge the business per view, so _their_ cost is fixed and ours is variable — the right side of the line. **Except during investor-funded seeding, when we fund the inventory ourselves and temporarily adopt the failure mode's economics**, at precisely the moment the business is most fragile.

**The strategic implication is uncomfortable and important: snap-apps receipt scanning is structurally the safest revenue in the whole group**, because its reward is funded by a purchase that already happened. It has been treated as a side channel. On this evidence it may be the better core business, with campaign video as the acquisition surface for it.

### 1.2 You are rebuilding Groupon's merchant problem, and Groupon is not mentioned once

The voucher-funded model has an **adverse selection** problem on the merchant side. Ask who is delighted to give away a IDR 50,000 voucher costing them IDR 15,000: it is the merchant with **weak demand**. The restaurant with a queue does not need you.

So the catalogue fills with the merchants users want least, the store feels cheap, and users churn — while the good merchants you need for credibility never join.

Groupon died of precisely this. Merchants got a flood of one-time deal-seekers who never returned, felt burned, and did not renew. **Merchant renewal rate — not redemption rate — is the number that decides whether this business exists.**

### 1.3 The voucher's perceived value degrades on contact with reality

[`09`](09-points-economy-and-redemption.md) §3 claims _"the user gets IDR 50,000 of genuine value."_ That is only true if they were going to spend IDR 100,000 at that merchant anyway.

For everyone else, a IDR 50,000 voucher with a IDR 100,000 minimum spend on food they had not planned to buy is worth perhaps IDR 15–20,000 of real utility — and they must lay out IDR 50,000 of their own money to get it.

**Users work this out by about week three.** When they do, the "reward is 70× the data cost" argument in [`06`](06-longform-video-and-attention.md) collapses, and so does the willingness to watch twenty minutes.

**Patch:** measure _realised_ value, not face value. Track what fraction of redemptions were incremental (the user would not otherwise have gone) versus subsidised (they were going anyway). Design toward low-minimum, high-utility rewards — data top-ups, transport credit, groceries — where the face value and the real value are almost the same. Those are exactly the digital goods already recommended for Phase 2; **they should be Phase 1, ahead of restaurant vouchers.**

### 1.4 The conversion you sell advertisers is manufactured, not organic

The pitch is _"IDR 25,000 per engaged prospect vs Meta's IDR 50,000–200,000 CAC."_ But the conversion event is a voucher redemption that we caused by giving away a voucher. It is not evidence the customer wanted the product.

The number that matters to a merchant — and the one they will eventually compute themselves — is **what fraction of voucher redeemers come back and pay full price.**

**The peer-reviewed answer for Groupon is 19.9%.** Roughly 80% of deal redeemers are new customers, but only about one in five ever returns at full price; merchant payback runs 15 to 98 months; merchant ratings fall around 10% after a deal; and only about 30% of merchants reach a seventh campaign. Groupon has never disclosed merchant churn in any SEC filing and stopped reporting merchant counts after IPO — which is itself informative.

**At a 19.9% return rate the CAC comparison is false**, and merchants will not renew after campaign one.

**Patch:** Gate 1 currently measures _"≥20% of issued vouchers redeemed."_ **That is the wrong metric.** Replace it with **"≥X% of voucher redeemers return and transact at full price within 90 days"**, captured through the merchant's own redemption API. Harder to measure, and it is the only number that proves the business.

---

## Tier 2 — Could break the plan

### 2.1 Phase 1 is roughly twice the size stated

Now that the tracker has estimates, the plan can be costed for the first time:

| Phase               | Tasks   | Ideal engineer-days                 | Settled |
| ------------------- | ------- | ----------------------------------- | ------- |
| U UI-first          | 29      | 106                                 | 15      |
| −1 Pilot            | 13      | 36                                  | 0       |
| 0 Foundations       | 60      | 211                                 | 6       |
| **1 Indonesia MVP** | **84**  | **341**                             | 1       |
| 2 Depth             | 16      | 211                                 | 0       |
| 3 Marketplace + AU  | 6       | 112                                 | 0       |
| **Total**           | **208** | **1,017 days ≈ 51 engineer-months** | **22**  |

**To the end of Phase 1: 694 engineer-days ≈ 35 engineer-months.** Of that, **79 days are already settled** (done or at review), leaving **615 days remaining**.

| Team         | Remaining time to end of Phase 1 |
| ------------ | -------------------------------- |
| 4 engineers  | **11.8 months**                  |
| 6 engineers  | **7.9 months**                   |
| 8 engineers  | 5.9 months                       |
| 12 engineers | 3.9 months                       |

_Figures regenerated 2026-09-19 from the live tracker. They have grown since first estimate — 156 tasks / 850 days — because implementation surfaced work that planning did not: contract gaps, policy resource kinds, the money-unit question, and the seam and security findings. **That growth is the plan getting more honest, not scope creep**, but it is growth and it should be read as such._

The roadmap says "2–3 months + 3–4 months". **That is only true at 8–12 engineers**, which it never said out loud. At a realistic early team of 4–6, launch is **8–12 months away** from here, and the critical path floor holds no matter how many people you hire.

Rough cost for the **remaining** work to Phase 1, engineering only: **~$75–125k** at Indonesian rates, **~$310–370k** at Australian rates. Add legal, infrastructure, seeded voucher inventory and salaries for the non-engineering roles below.

### 2.2 The plan quietly requires 12–14 people, not a dev team

Named or implied across the docs: CEO/sales lead, CTO, **economy owner**, **finance owner**, compliance/legal liaison, merchant operations (KYB, onboarding), moderation reviewers, support, plus 6–8 engineers.

Several of these are gates, not nice-to-haves — the plan says the economy owner and finance owner must exist **before launch**. **That headcount has never been costed and should be, before the investor conversation, not after.**

### 2.3 You are building a coalition clearing house before proving anyone wants a coalition

Partner funding, clearing accrual, weekly netting, signed statements, float segregation, coverage ratio: weeks of engineering to manage what, at ten merchants, is a spreadsheet.

The cross-redemption coalition is genuinely the moat — but **a coalition of ten merchants is not a coalition**, and every hour spent on clearing machinery is an hour not spent finding out whether anyone watches the videos.

**Patch:** build the _ledger_ and the _funding record_ in Phase 0 (they are unavoidable). Defer netting, statements and automated payout to Phase 2. Run settlement manually until there are ≥30 active partners.

### 2.4 Two data planes from day one is premature

I justified this as "brutal to retrofit". On inspection that is true of the **data model** — country-scoped identifiers, no cross-border foreign keys, region in every partition key — and **not** of the **deployment**.

**Patch:** enforce country isolation in the schema from day one; deploy **one region** until Australia is actually funded. Halves the Phase 0 infrastructure work, halves the monthly infrastructure bill, and removes a second production environment from the riskiest phase. This is a correction to my own plan.

### 2.5 The stack was locked without the one input that determines it

[`15-stack-locked.md`](15-stack-locked.md) commits to Go + TypeScript across six deployables. **That decision is currently unjustified**, because G1 — team size and skills — is still unanswered.

At 4 engineers the right answer is almost certainly **TypeScript only, two deployables**. Go buys latency headroom the traffic does not need and review discipline that a four-person team enforces socially anyway. Treat the locked stack as provisional until the team is known.

### 2.6 The long-form format invites a comparison the rewards framing must survive

_Rewritten 2026-09-19. **The original version of this section used the wrong benchmark and I am correcting it rather than defending it.**_ It said _"AUD 5 for twenty minutes is far below the Australian minimum wage and reads as insulting."_ Minimum wage is the wrong yardstick, and the comparison silently assumed watching is labour — which is the thing in question, not a given. Nobody benchmarks Flybuys or Everyday Rewards against an hourly rate.

**But "it is a reward, do not benchmark it" is not right either.** Users benchmark. The question is only _against what_ — and the answer is set by the **format**, not by the reward size.

| Comparison class                                | What it asks                                           | Marginal effort | What users expect                              |
| ----------------------------------------------- | ------------------------------------------------------ | --------------- | ---------------------------------------------- |
| **Loyalty card** (Flybuys, Everyday Rewards)    | Scan while doing something you were doing anyway       | ≈ 0             | Any bonus is free money. No rate is computed   |
| **Quick feed** (15–60 s, YT-0414)               | A few seconds of idle attention                        | Very low        | Sits comfortably here                          |
| **Paid research** (survey panels, focus groups) | Dedicated, exclusive, scored attention                 | High            | **A rate is computed, and market rates exist** |
| **Long-form + scored quiz** (YT-0412 + YT-0413) | 20 minutes of sustained attention, comprehension-gated | High            | **Lands here, not in loyalty**                 |

**The corrected analysis, and it is better news than the original.** The right comparison class for long-form is **paid survey panels**, not minimum wage. Australian online panels typically pay in the order of a few dollars for 15–20 minutes. Against _that_ benchmark the reward scale is defensible, and possibly generous.

**The live risk is therefore narrower and sharper than the original claim, and it is not about Australia specifically:**

1. **Format, not size.** Twenty minutes of gated, scored attention resembles work in a way scanning a card does not. A user who feels asked to _work_ will apply a work-shaped judgement whether or not we intend one. The Quick feed is safely inside the loyalty framing; long-form is where the tension lives.
2. **Partner-funded means variable.** Reward magnitude is not guaranteed — it depends what a partner contributes. A thinly funded long-form campaign lands in the research comparison class **with a loyalty-sized reward**, which is the worst of both. This applies in both markets.
3. **The honest entry card is the mitigation, and it becomes load-bearing.** If the reward is a reward rather than a fee, the user must be able to judge _"not worth twenty minutes"_ and decline cheaply, before any playback. That is YT-0411's stated intent; under this framing it stops being a courtesy and becomes the control that keeps the framing honest.

**Falsifiable, and there is a place to settle it:** YT-0451's reaction sessions. Ask fifteen users what they think a twenty-minute campaign _should_ pay, and whether they reach for a per-hour number unprompted. If they do, the format has left the loyalty frame regardless of intent.

**What this does not rescue.** Indonesia still validates the software, the merchant mechanics and the fraud model, but its _reward-attractiveness_ result does not transfer, because the reward-to-local-income ratio is not comparable. If Australia is the primary market, **Australian reaction sessions are required before Australian launch** — Indonesian ones will not stand in.

---

## Tier 3 — Specific errors and unverified assertions

| #   | Problem                                                                                                                                                                                                                                                  | Patch                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 3.1 | ~~CDN segment-log cross-check unverified~~ **Confirmed failed — promoted to Tier 1 §1.0**                                                                                                                                                                | See [`22`](22-assumption-audit.md)                                                                                      |
| 3.2 | **The devaluation policy is unworkable as written.** "Never devalue silently, always announce" is right in principle; in practice every announced devaluation is a trust event, and airlines survive them only because of switching costs we do not have | Do not reprice existing inventory. Add higher-priced tiers and let the mix shift; cap issuance rather than raise prices |
| 3.3 | **Open Viewing contaminates the measurement product.** Sales will want to blend open and rewarded views to show bigger numbers, destroying the "verified attention" differentiator                                                                       | Make blending structurally impossible, not a policy. Separate metrics, separate reports, separate line items            |
| 3.4 | **Self-hosted Zitadel is an ops tax during the riskiest phase.** Any self-hosted IdP is a security-critical service someone must patch, monitor and restore                                                                                              | Use managed Zitadel Cloud through Phase 1; self-host once there is a platform engineer                                  |
| 3.5 | **The 300-line rule may fight the domain core.** A correct ledger with double-entry, idempotency and invariant checking has files that want to be ~400 cohesive lines; splitting them arbitrarily harms readability                                      | Exempt `services/ledger` domain files at 500 lines, documented as a deliberate exemption rather than a suppression      |
| 3.6 | **No churn or retention model exists anywhere in the plan.** Every economic projection assumes users keep coming back, and nothing estimates or measures it                                                                                              | Add D1/D7/D30 cohort retention to Gate 1 with explicit targets before launch, not after                                 |
| 3.7 | **Support cost is entirely unmodelled.** Rewards platforms generate very high support load — "where are my points", "the voucher did not work", "why was I suspended" — and every ticket is about money                                                  | Model tickets per 1,000 active users and budget staff. This is a major operating cost, not an afterthought              |
| 3.8 | **Cloudflare is a single point of failure** for video, CDN, WAF, bot defence and object storage                                                                                                                                                          | Accept it, but write the failure mode into the runbook and keep source assets in R2 _plus_ one other store              |

---

## Tier 4 — Questions the plan cannot currently answer

1. **What is the repeat-purchase rate of a voucher-acquired customer?** The entire advertiser pitch depends on it and nobody has measured it.
2. **Who makes the videos?** See 1.1. Unresolved.
3. **What happens when a large merchant demands category exclusivity?** It is the first thing a big chain will ask for, and it breaks a fungible coalition.
4. **What is the churn rate of merchants after campaign one?** Groupon's answer was brutal.
5. **Can prices be raised?** The plan assumes a 25% clearing spread holds. What stops a merchant going direct to the users they met through you?
6. **What is the actual ceiling on this market?** Nobody has sized how many Indonesian SMBs have both the margin and the willingness. It may be thousands, not hundreds of thousands.

---

## The cheaper plan that tests the same thesis

The most useful criticism I can offer is not a list of flaws but a smaller plan. Phase 1 as scoped is **341 engineer-days** before anyone knows whether the core trade works.

This is no longer only my opinion. [`21`](21-failed-analogues.md) independently names the cheapest falsification as _ten merchants, a landing page, hand-issued vouchers_, and argues the deciding KPI is **merchant second-campaign rate, not MAU**. Two separate lines of analysis arriving at the same answer is the strongest signal in this document.

**Strip it to this:**

| Keep                                    | Drop until validated              |
| --------------------------------------- | --------------------------------- |
| Web app, phone signup                   | Points **entirely**               |
| 1–3 minute videos                       | The store                         |
| Business-authored questions             | The coalition and clearing house  |
| **A voucher for that merchant, direct** | Cross-redemption                  |
| Manual merchant redemption portal       | Merchandise, marketplace, charity |
| Open Viewing                            | Mini-games, surveys, offerwall    |
| Basic fraud controls                    | Two data planes, ML, CDP          |

Watch a 2-minute video → answer 3 questions → receive a voucher for that merchant → redeem it in the shop. **Roughly 60–90 engineer-days, not 341**, and it answers the two questions the whole business rests on: _will people watch and answer_, and _will merchants pay and renew_.

Points, the pooled store and the clearing house are what make this a **platform** rather than a tool — and they are the right thing to build **second**, once merchants have renewed. The coalition is the moat, but you cannot build a moat around an empty castle.

---

## What is genuinely strong, for calibration

The checkpoint-question mechanic solving fraud, recall and research at once. The three-currency model and the solvency invariant. Skill-only games avoiding the Indonesian prize-draw regime. Void-and-remint on transfer. Refusing to sell data while using it internally. Pricing against CAC rather than CPM. The instinct to prove in a cheap market first.

**The thinking is unusually good. The scope is roughly three times what the evidence currently justifies.**
