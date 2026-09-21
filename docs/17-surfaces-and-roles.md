# YourTal — Surfaces, Roles & the Logged-Out Experience

**Date:** 2026-09-19
**Why this doc exists:** earlier docs named roles (`business admin`, `merchant staff`) without specifying them, and said nothing about what a visitor who has not signed up can actually do. Both are load-bearing.

---

## 1. What the platform looks like — neither YouTube nor Netflix

Both analogues are wrong, and taking either would produce the wrong product.

|                      | Netflix                    | YouTube                                       | **YourTal**                                      |
| -------------------- | -------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Why the user is here | To be entertained          | To find something specific, or be entertained | **To earn**                                      |
| The video is…        | The product                | The product                                   | **The price of the reward**                      |
| Success looks like   | Hours watched              | Hours watched                                 | **Rewards earned and redeemed**                  |
| Browse question      | "What do I want to watch?" | "What am I looking for?"                      | **"What's the best use of my next 20 minutes?"** |

Users do not come for the content. They come for the voucher, and the video is what they pay. That inverts every design decision a video platform makes: we never hide the duration, never autoplay into the next item to inflate watch time, and never bury the reward.

**The right analogues are Shopee/Tokopedia's home screen, an offerwall, and Duolingo** — a bright, dense board of things to do, each with its value stated, plus a streak and a clear "do this next."

> **The platform is a rewards marketplace with a video player inside it, not a video platform with rewards attached.**

### 1.1 Five surfaces

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│   Earn   │  Quick   │  Store   │  Wallet  │    Me    │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

| Surface         | Shaped like                       | Purpose                                                                                                                                                                       |
| --------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Earn** (home) | Shopee home — dense grid of cards | The board. Every card shows **duration · reward · ~MB · merchant**. Sorted by expected value to _this_ user.                                                                  |
| **Quick**       | TikTok — vertical, swipeable      | 15–60 s campaigns, points only. **This is the habit loop** — the thing that fills dead time and brings people back daily. Long-form is the "sit down and earn properly" mode. |
| **Store**       | Tokopedia product grid            | Vouchers, digital goods, merchandise. Price in points, terms visible before committing.                                                                                       |
| **Wallet**      | Banking app, simplified           | Balance, pending (in holdback), expiring soon, vouchers with their QR, history.                                                                                               |
| **Me**          | Settings                          | Profile, interests, consent controls, security (passkey), language, referrals.                                                                                                |

Tablet and desktop widen the layout — more columns, persistent side navigation. **Not a different product.**

### 1.2 What we deliberately do _not_ copy

| Pattern                            | Why not                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| Autoplay-next                      | Inflates watch time we pay for and the user did not choose                                |
| Infinite entertainment feed        | We have no content supply problem to solve, and it costs delivery minutes nobody funded   |
| Hidden duration                    | The entry card is a contract. Hiding the price is how you get one-star reviews            |
| Recommendations that ignore reward | Users optimise for reward-per-minute. Pretending otherwise just makes ranking look broken |

## 2. Business dashboard

A business may hold any subset of three relationships (advertiser, supplier, redeemer), so the dashboard has three zones and shows only the ones they use.

| Zone           | Contains                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| **Campaigns**  | Create/edit, video upload, chapters, question bank, targeting, budget, point allocation, live performance     |
| **Inventory**  | Listings, settlement value `S`, stock, transferability and partial-redemption policy, per-listing performance |
| **Redemption** | Manual code lookup, redemption log, API credentials and webhooks, integration status                          |
| **Reports**    | Completion by chapter, question accuracy, recall score, redemption attribution, footfall                      |
| **Billing**    | Point pre-purchases, settlement statements, invoices, disputes                                                |
| **Team**       | Members, roles, invitations, audit of who did what                                                            |

### 2.1 Business roles

Yes — each business administers its own people. Six roles, least-privilege by default:

| Role             | Profile | KYB | Campaigns | Inventory | Redeem | Reports | Billing | Team               |
| ---------------- | ------- | --- | --------- | --------- | ------ | ------- | ------- | ------------------ |
| **Owner**        | ✎       | ✎   | ✎         | ✎         | ✓      | ✓       | ✎       | ✎ + delete account |
| **Admin**        | ✎       | ✎   | ✎         | ✎         | ✓      | ✓       | view    | ✎                  |
| **Marketer**     | view    | —   | ✎         | —         | —      | ✓       | —       | —                  |
| **Merchandiser** | view    | —   | —         | ✎         | —      | ✓       | —       | —                  |
| **Finance**      | view    | —   | —         | —         | —      | ✓       | ✎       | —                  |
| **Analyst**      | view    | —   | view      | view      | —      | ✓       | —       | —                  |
| **Store staff**  | —       | —   | —         | —         | ✓      | —       | —       | —                  |

**Profile and KYB are separate columns for a reason.** The business profile is its own name, address and contact — anyone working for the business may read it, and hiding it from a marketer serves nobody. **KYB is director identity and tax registration**, which is sensitive and stays owner/admin. An earlier version of this table had no Profile column at all, which forced an implementer to infer the answer from the Reports column; the inference was right, and the gap was mine.

Rules that are not negotiable:

- **Exactly one Owner**, transferable only by the current Owner with re-authentication.
- **Two-person approval** on: bulk voucher issuance, **any downward change to a settlement value**, and API credential rotation.
  - **There is no materiality threshold, by founder decision 2026-09-21 (YT-0576).** This line previously read _"downward by more than a threshold"_ and **named no number** — as did the resource schema and the policy, so the phrase had three references and zero definitions. An agent supplied `MATERIAL_SETTLEMENT_DECREASE_THRESHOLD = 0.2` as a loudly-commented placeholder so the control would not be a no-op, which was correct behaviour and left a number nobody had decided standing in front of a two-person approval. **It was removed rather than ratified.**
  - **Why no threshold is safer than a small one:** a threshold creates a band below the line in which a cut passes with one pair of hands, and the band is reachable repeatedly. Two 15% cuts under a 20% threshold take `S` down 27.75% with nobody approving anything. A settlement cut is a direct reduction in what a user's points are worth, since `points_price = (S / B) × demand_multiplier`. Defeating a no-threshold rule requires defeating the approval workflow itself, which is the thing that was actually designed.
  - **One definition, three readers:** `isMaterialSettlementDecrease(current, proposed)` in `apps/api/src/modules/store/material-settlement-decrease.ts` returns `proposed < current`; `policies/resource_policies/listing.yaml:83` consumes `R.attr.isMaterialSettlementDecrease` and **defines no number of its own**, denying on absence rather than allowing; and this line is the documentation. The attribute keeps the word "material" deliberately — renaming it would be a policy change wearing a refactor's clothes.
- **Every team action is audit-logged** and visible to the business itself, not just to us.
- **No business role can ever grant points.** Issuance happens only through Reward Engine campaign rules — a business admin cannot credit an account they control.

### 2.2 Store staff are a different kind of user

A cashier on a shared phone in a busy shop is not an office user, and giving them a normal account is the standard mistake. Following how Square and Shopify handle POS:

- **Device sessions, not personal accounts.** An Admin provisions a **store device** — bound to a location, named ("Kemang counter 2"), with a long-lived refresh credential on that device only.
- **A short PIN unlocks the session**, it does not authenticate a person. Staff turnover does not mean account churn.
- **Revocable instantly and individually** from the Team zone. A lost phone is one tap.
- **Capabilities: redeem a voucher, look up a code, view today's redemptions.** Nothing else. Never mint, never adjust, never see reports.
- **Every redemption records the device, not a named individual** — with an optional staff PIN layer for businesses that want per-person attribution.

## 3. User "dashboard"

Consumers do not want a dashboard; they want to know three things at a glance. The **Wallet** answers them:

| Question                   | Answer on screen                                                |
| -------------------------- | --------------------------------------------------------------- |
| _What do I have?_          | Available balance, prominent                                    |
| _What's coming?_           | Pending points still in holdback, **with the date they unlock** |
| _What am I about to lose?_ | Expiring soon, surfaced before it matters, never after          |

Plus: active vouchers with their offline QR, redemption history, points history in plain language (_"Completed Kopi Kenangan campaign — 2,400 points"_, not `TXN_CREDIT_CAMPAIGN_4471`), and progress toward the next tier or streak.

**Me** carries profile, declared interests, per-purpose consent toggles that actually work, passkey setup, language and referrals.

## 4. The logged-out experience — Open Viewing

Anonymous visitors are the **primary organic acquisition channel** (the catalogue is a large indexable corpus of exactly what Indonesians search for) **and now a product in their own right.**

**Decision: anonymous visitors may watch a full campaign video, with no reward, ever.** The business benefits — free reach, top-of-funnel, and viewers who convert on their own site without any voucher cost.

### 4.1 The distinction that makes this safe

An earlier draft rejected anonymous watching. That was too blunt: it conflated two different things.

| Pattern                                                            | Verdict                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous watch → **no reward, not retroactively claimable, ever** | **Safe.** There is nothing to extract, so there is no farming incentive.                                                                                                                                                               |
| Anonymous watch → **claim the reward after signing up**            | **Rejected.** Checkpoint tokens bind to a user, the risk score gates the credit, and the holdback clock starts at earn. A claimable anonymous path is a free farming surface with no identity anchor, no velocity cap and no holdback. |

The line is **claimability**, not anonymity. Open Viewing sits safely on the right side of it.

### 4.2 Two tiers of view, and the business pays for both

This creates a genuinely useful product split, and it is the same split the ad industry already understands as performance versus awareness:

|                         | **Rewarded view**                                   | **Open view**                   |
| ----------------------- | --------------------------------------------------- | ------------------------------- |
| Viewer                  | Signed in, phone-verified, risk-scored              | Anonymous                       |
| Questions               | Required, gate the reward                           | Offered, optional, never gate   |
| Reward cost to business | Points + voucher/merchandise                        | **None**                        |
| Platform fee            | Full rate per verified completed view               | **Low rate per qualified view** |
| Verification            | Checkpoint tokens, CDN cross-check, attention proof | IVT filtration only             |
| What the business buys  | Verified attention + a measured conversion          | Reach and funnel                |

**Open views are billed, not free.** Delivery costs us roughly $0.03 for a 30-minute view, and the rule from [`10-tech-stack.md`](10-tech-stack.md) still holds: **every delivered minute must belong to a funded campaign.** Unfunded anonymous viewing is an unbounded bill with no offsetting revenue.

Practically: Open Viewing is a **per-campaign opt-in with its own budget line**, off by default so nobody is surprised by a charge, and sales can hand out a free allowance of first-N views as a sweetener.

### 4.3 What this forces us to get right

| Requirement                       | Why                                                                                                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IVT filtration before billing** | Once open views are billable, bots have an incentive again — for the advertiser's money rather than the reward. MRC GIVT filtration moves from a Phase-2 nicety to a **prerequisite for billing an open view**. |
| **Rate limits**                   | Cap open-view minutes per device and IP per day; Turnstile after the first view; no concurrent anonymous sessions.                                                                                              |
| **Data-cost honesty**             | An anonymous viewer spending 180 MB for no reward deserves to know first. Show duration and MB more prominently, not less, and default to the lowest quality tier.                                              |
| **No reward machinery**           | Open views issue no checkpoint tokens and touch neither the Reward Engine nor the ledger. Cleanly separate code paths.                                                                                          |

### 4.4 The conversion mechanic

An anonymous viewer who has just watched twenty minutes is the warmest possible signup. Show the foregone reward honestly throughout — _"a signed-in viewer would have earned 2,400 points here"_ — and prompt at the moment a logged-in user would have been paid.

That is the moment of maximum regret and maximum intent. It is also completely honest: we are telling them exactly what they chose not to have, and offering it for next time.

After signup, return the user **exactly where they were**. Deep links survive the auth round trip.

### 4.5 Indexing boundary — now much stronger

Because the full video is publicly watchable, **campaign pages become genuinely valuable public content** rather than thin preview stubs. That satisfies Google's "video is the main content of the page" requirement and turns every campaign into a real organic landing page.

Public and indexable: offer pages, merchant pages, catalogue, **campaign pages including the video**, help, marketing.
Gated and `noindex`: questions, points, wallet, all dashboards.

This supersedes the preview-only recommendation in [`11-seo-aeo-geo.md`](11-seo-aeo-geo.md) §7 — the gate moved from the video to the reward.

### 4.6 What an anonymous visitor still cannot do

Hold a balance · earn or accrue anything · redeem · transfer or receive a voucher · have any answer counted toward a reward.

## 5. Internal roles

| Role             | Can                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Support**      | View a user's account and history, open a case, issue a goodwill credit below a threshold — **from the funded reserve, never minted** |
| **Moderator**    | Review flagged creatives and question banks, approve/reject with a reason                                                             |
| **Risk analyst** | Review suspicious clusters, suspend and reinstate, never adjust balances                                                              |
| **Finance**      | Ledger adjustments (dual-approved), settlement runs, breakage and liability reporting                                                 |
| **Ops**          | Merchant onboarding, KYB, listing approval                                                                                            |
| **Admin**        | Role grants, feature flags, kill switches — **no direct data access**                                                                 |

Separation of duties throughout: whoever can _suspend_ cannot _adjust_, and whoever can _adjust_ cannot _approve their own adjustment_.

---

## What this adds to the backlog

YT-0200 to YT-0206 in [`phase-1-experience.md`](tasks/phase-1-experience.md) and [`phase-1-campaign.md`](tasks/phase-1-campaign.md) — business team management, store-device sessions, the five-surface information architecture, the Quick feed, the logged-out surfaces, and the conversion flow.
