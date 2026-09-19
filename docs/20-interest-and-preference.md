# YourTal — How We Learn What People Want

**Date:** 2026-09-19

**Short answer: not machine learning, not at first — and that is a deliberate advantage, not a limitation.**

For the first year we learn preference by **counting weighted evidence**. ML arrives in Phase 2, on top of a profile that already works. Three reasons, in order of importance:

1. **Volume.** With tens of thousands of users, a model is worse than counting. ML needs data density we will not have until Phase 2.
2. **Explainability.** A counting model can tell a user *"we think you like coffee because you redeemed three coffee vouchers."* A neural model cannot. That is a trust feature, a regulatory defence, and an advertiser-confidence feature all at once.
3. **Debuggability.** When targeting goes wrong in month three — and it will — you want to read the reason off a row, not interrogate a model.

---

## 1. Our signals are better than Meta's, and here is why

Meta and TikTok infer interest from **passive** behaviour: dwell time, scroll velocity, likes. It is abundant and cheap, and it is noisy — you linger on something because it is confusing as often as because you want it.

Our strongest signals are **costly**. The user gave up something to send them. In signalling theory a costly signal is a reliable one, and almost all of ours cost the user something real:

| Signal | What it costs the user | Reliability |
|---|---|---|
| **Redeemed a voucher at the merchant** | A trip to a shop | Highest — a verified real-world act |
| **Spent points on a listing** | Scarce currency they earned | Very high — a genuine purchase decision |
| **Bought it** (snap-apps receipt) | Actual money | Very high — observed, not inferred |
| **Answered a preference question** | Attention, during a campaign | High — explicitly declared |
| **Completed a 20-minute campaign** | Twenty minutes and ~150 MB | High |
| **Chose this campaign over others** | An opportunity cost on the Earn board | Medium — a deliberate pick, not a scroll |
| **Abandoned at minute 3** | — | Medium, negative |
| Browsed or searched the store | Nothing | Low |
| Declared an interest at onboarding | Nothing, but it is explicit | Medium, decays slowly |

The Earn board matters more than it looks: users **choose** from a visible set with stated rewards. That is a revealed preference under a known price — much closer to an economic choice than a scroll past something in a feed.

## 2. The taxonomy

A hierarchical interest tree of roughly 300–500 nodes, versioned in the contracts package:

```
food-and-drink
├── coffee              ├── local-chains  ├── specialty
├── fast-food
├── groceries
└── delivery
personal-care · fashion · electronics · telco · transport
finance · health-and-fitness · education · travel · home · entertainment
```

Plus a small set of **context** dimensions kept separate from interests: price sensitivity, day-part activity, district, device class, data-consciousness.

Merchant categories, listing categories and receipt categories all map onto this one tree, which is what makes signals from different sources commensurable.

## 3. The scoring model (Phase 1)

For each user and each interest node:

```
score(user, interest) = Σ  weight(signal) × decay(age) × confidence(source)
```

**Weights** — illustrative opening values, to be tuned against actual conversion:

| Signal | Weight |
|---|---|
| Voucher redeemed at merchant | 10 |
| Points spent on a listing | 8 |
| Receipt purchase in category | 8 |
| Campaign completed | 5 |
| Preference question answered | 5 |
| Declared interest at onboarding | 4 |
| Campaign started | 3 |
| Store search | 1 |
| Campaign abandoned before 25% | −2 |

**Decay** — a 90-day half-life on behavioural signals, 365 days on declared ones. People's tastes move; a coffee habit from eighteen months ago should not still be driving targeting.

**Confidence** — an interest is not actionable until it has **at least 3 independent signals from 2 distinct sources**. One receipt is a coincidence; three signals is a preference. This single rule prevents most of the creepy-and-wrong targeting that makes users distrust a platform.

Scores are recomputed on a schedule, not in the request path. The serving path reads a materialised profile from Redis.

## 4. Consent partitions the profile — there is not one profile

This is the part that is architectural rather than a filter bolted on at the end.

Each signal source is bound to a **purpose**. The profile is computed only from signals the user has consented to *for that purpose*. So a user might have:

| Purpose | Signals permitted | What it can drive |
|---|---|---|
| **Service** (always) | Own campaign history, own store activity | Ordering their own Earn board, avoiding repeats |
| **Ad targeting** (opt-in) | The above, plus questions and declared interests | Campaign targeting |
| **Purchase-based targeting** (separate opt-in) | The above, plus receipt data | Category targeting on observed purchases |
| **Research** (separate opt-in) | Question answers | Aggregate panel data sold to buyers |

Withdraw a consent and the corresponding signals stop contributing on the next recompute — not "eventually", not "on request". The consent service's answer is load-bearing in code, which is YT-0214.

## 5. Cold start for a new user

The first session has no history, and pretending otherwise produces bad recommendations and a bad first impression.

1. **Ask.** Onboarding picks 5 interests from the tree with pictures, in about 15 seconds. Explicit beats inferred at day zero.
2. **Geography and popularity.** What is redeemed near them, by everyone.
3. **Learn from the first three choices.** Which campaigns they pick from the Earn board moves the profile fast because the Earn board is a choice under a stated price.
4. **Do not over-personalise early.** Keep genuine diversity in the board for the first two weeks or the profile collapses into a narrow loop before it knows anything.

## 6. Where ML actually earns its place — Phase 2

Only once there is volume, and only for specific jobs:

| Model | Job | Why it beats counting |
|---|---|---|
| **Collaborative filtering** (matrix factorisation) | "Users who redeemed this also redeemed that" | Finds affinities no taxonomy anticipated |
| **Two-tower embeddings** | User ↔ campaign retrieval | Handles a catalogue too large to score exhaustively |
| **`p(completion)`** | Will this user finish this 22-minute video? | The single most valuable prediction we can make — it protects delivery cost and advertiser outcomes |
| **Category inference from receipts** | Map messy merchant strings to taxonomy nodes | Text classification, genuinely better than rules |
| **Look-alike audiences** | Find users resembling a merchant's converters | What advertisers ask for by name |

**The counting profile stays.** It becomes a feature input and the fallback, and it remains the thing we show the user when they ask why. We never replace an explainable system with an opaque one — we layer.

## 7. What advertisers actually see

Never a profile. Never a row. **Cohorts with a floor.**

- A targetable or reportable segment must contain **≥1,000 users** in that country. Below the floor it does not exist in the interface.
- Advertisers select from the taxonomy, not from raw signals: *"interested in coffee, in South Jakarta, price-sensitive"* — never *"bought at Kopi Kenangan on 14 March"*.
- Reporting is aggregate: reach, completion, recall, redemption rate by cohort.
- No export of user-level data exists in any interface, for any account tier. "We share data with advertisers" should be **architecturally false**, not contractually discouraged.

## 8. Receipt data — the crown jewel, handled carefully

From snap-apps, per receipt we extract and keep:

**Keep:** merchant, merchant category, taxonomy categories present in the basket, basket total band (not the exact figure), date, and the derived frequency.
**Discard:** the raw image and the itemised line detail, after a short processing window.

That minimisation is deliberate. Category signals are what targeting needs; a permanent archive of everything a person has ever bought is a liability with no matching benefit to us.

Receipt-based targeting requires its **own opt-in consent**, separate from signup, revocable, with a stated retention period.

## 9. What we refuse to infer

Receipt and behavioural data *will* imply sensitive things. A pharmacy basket implies health. A purchase pattern implies pregnancy, religious observance, or financial distress. Both PDP and the Australian regime treat some of these as sensitive categories with stricter rules — and inferring them is the fastest way to turn a data asset into a scandal.

**Blocklist, enforced in the taxonomy itself — these nodes cannot be created, scored or targeted:**

health conditions · pregnancy and fertility · religion and religious observance · political affiliation · sexual orientation · ethnicity · financial distress · addiction · immigration status · trade union membership

Where a merchant category unavoidably implies one (a pharmacy, a place of worship), the merchant is mapped to a neutral parent node and the sensitive leaf is never derived. This is a hard constraint in the category mapper, not a policy document.

## 10. "Why am I seeing this?" — explainability as a feature

Because the Phase 1 profile is counting-based, every user can be shown exactly why:

> **Why this campaign?**
> You redeemed 3 coffee vouchers · You said you're interested in Food & Drink · Popular in South Jakarta
> *[Not interested in coffee]* → adjusts immediately

Meta cannot offer this honestly. We can, and it does three jobs at once: it builds trust, it gives us a **correction signal** that is more valuable than the inference it fixes, and it is the strongest possible evidence of compliance in both regimes — a regulator asking "how do you use this data" gets shown the screen the user already sees.

This is only possible because we did not start with a model. It is a good enough reason on its own to sequence it this way.

---

## Tasks

YT-0215 to YT-0218 in [`phase-1-experience.md`](tasks/phase-1-experience.md): the interest taxonomy, the scoring service, cohort-floor enforcement, and the explainability surface.
