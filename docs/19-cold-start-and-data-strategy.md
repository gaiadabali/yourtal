# YourTal — Cold Start, Momentum & the Data Thesis

**Date:** 2026-09-19
**Status:** The founder's strategic thesis, recorded, sharpened, and with two corrections flagged.

---

## 1. The thesis

> Investors inject into both the chicken and the egg. Vouchers entice users to register and get hooked, which brings businesses in. If that works, the eggs hatch more chickens and the chickens lay more eggs. A new branch of advertising beside the Meta/Google duopoly — not big enough to warrant their attention, but adding flavour to the market. Slow, organic, fundamentally strong, and therefore sustainable. Unregistered viewers hand brands free analytics. Shareable material spreads it. And above all, the objective is **data**: never sold, used internally to make the engines smarter, which attracts more businesses and more users.

The shape of this is right. Three things need sharpening and two need correcting.

## 2. Breaking a two-sided cold start — do not subsidise both sides

The instinct to fund both sides is natural and it is the expensive way to do it. Every marketplace that solved cold start did the same thing instead: **subsidise one side hard, in a deliberately narrow slice, until that slice is dense enough to be self-sustaining — then move the boundary.**

| Approach | Outcome |
|---|---|
| Subsidise both sides, broadly | Two thin markets. Users see an empty store; merchants see no footfall. Money burns with nothing compounding. |
| **Subsidise the supply side, in one narrow slice** | A user in that slice sees a *full* store. Merchants in that slice see real footfall. The slice becomes referenceable, and the next slice costs less. |

**So: buy voucher inventory, not users.** The investor money should go into the platform pre-purchasing merchant inventory at settlement value — which makes the store look abundant on day one — rather than into user acquisition. A dense store acquires users on its own; paid users arriving at an empty store churn immediately and cost twice.

**Go narrower than Jabodetabek.** Pick **2–3 districts and 3–5 merchant categories** that a single person visits weekly — coffee, food delivery, pulsa/data, groceries, transport. Density inside a small boundary beats coverage across a big one. This is the city-by-city playbook, and the reason to hold the line is that a user who opens the store and finds nothing they want never comes back, however good the campaign was.

## 3. The subsidy already has a home in the architecture

This is worth knowing, because it turns "burn" into a measured number.

Investor-funded seeding is not a special case. It is the platform acting as a **funding partner**: cash goes into the segregated reserve, points are issued against it, inventory is bought at settlement value. Which means:

- The subsidy shows up in the **coverage ratio** like any other funding. It cannot be spent twice or lost track of.
- **Rule K6 still binds** — every point issued without a business paying for it must be backed by real cash at the moment of issuance. Investor money is exactly that cash.
- Burn is measurable as `points issued × B` against reserve drawdown, per week, per district, per category.
- When a merchant later funds their own campaign, the subsidy *reduces automatically* with no code change. The dial is the funding mix, not the mechanism.

**Implication:** ask the investor for a number in the reserve, not a marketing budget. It is the same money and it is auditable.

## 4. The competitor you are watching is not the one that matters

**Agreed: Meta and Google will not notice, and will not care.** That judgement is correct and strategically useful. We are not competing for their inventory or their advertisers' core budget; we are selling a different unit (verified attention + a measured in-store conversion) to a budget line they do not serve well.

**The real risk is closer to home.** The companies that could do this natively, tomorrow, already have the merchants, the users, the wallet, the ad product and the logistics:

| Threat | Why it is real | Why we still have room |
|---|---|---|
| **GoTo (Gojek/Tokopedia)** | Merchants, wallet, ads, logistics, coins already | Their ad product serves their own commerce funnel; long-form merchant video sits awkwardly inside it |
| **Shopee** | Gamification and coins are already best-in-class in this market | Same — the video would be a distraction from GMV |
| **Grab** | Merchants, wallet, ads | Same |
| **TikTok Shop** | Video plus commerce in one place, huge reach | No merchant-funded voucher clearing, no verified-attention product |

The honest read: each of them *could* build this and none of them *wants* to, because it does not obviously grow their core metric. That is our window, and it is a window, not a moat. **What turns it into a moat is the clearing house** — once a merchant's points are redeemable at other merchants, the coalition itself is the thing that is hard to copy, because it requires signing everyone else too.

Worth stating plainly: a realistic good outcome for this business is **acquisition by one of the four above**, and the asset they would be buying is the merchant network plus the clearing relationships — not the technology.

## 5. Virality — and the connection you may not have made

**Open Viewing is what makes sharing work.** A shared campaign link that hits a login wall dies on arrival; one that plays immediately converts a fraction of everyone who taps it. The decision to let anonymous visitors watch the full video is not just a funnel gift to the business — it is the precondition for every sharing mechanic on the list.

Shareable moments, in order of likely strength:

| Moment | What is shared | Why it spreads |
|---|---|---|
| **Voucher earned** | "I got a IDR 50,000 voucher for watching 20 minutes" | Concrete, specific, and slightly unbelievable — which is what makes people click |
| **Campaign link** | A playable campaign page | Works instantly for the recipient because of Open Viewing |
| **Merchant deal page** | An offer at a named local business | Indexable, local, searchable — doubles as the SEO surface |
| **Streak / milestone** | Progress | Weak. Nobody cares about a stranger's streak |
| **Referral** | An invite | Real, but pays on the referee's day-7 activity, never on signup |

The first two are the ones worth engineering. Both are already public pages, so the marginal cost is Open Graph tags and a share sheet.

## 6. The data thesis

Agreed on direction: **data is the compounding asset.** Two corrections on framing.

### 6.1 What is actually ours

Most data we could collect is commodity — Meta and Google have more of it and better. Being precise about the difference is what keeps the strategy honest:

| Data | Who has it better | Value to us |
|---|---|---|
| Demographics, interests, browsing | Meta, Google | Commodity. Do not build a strategy on it |
| **Verified attention duration** | **Nobody** | Proven watch time with cryptographic backing, not a viewability pixel |
| **Comprehension / recall scores** | **Nobody** | Did they understand the claim? Sellable as a product |
| **Voucher redemption as conversion** | **Nobody** | A closed loop ending at the merchant's till |
| **Receipt-level purchase data** (snap-apps) | **Nobody at this granularity** | What was actually bought, where, for how much. The crown jewel |

The last four are the asset. The first row is not, and chasing it would waste years.

### 6.2 The flywheel needs four named loops, not a slogan

"Data makes the engines smarter" is directionally true and operationally useless. The loops that actually close:

| Data in | Engine | Improvement out | Measurable as |
|---|---|---|---|
| Completion and drop-off by chapter | Ranking → `p(completion)` | Fewer wasted delivery minutes; better advertiser outcomes | Delivery cost per completed view ↓ |
| Question accuracy by creative | Creative quality scoring | Better videos get better placement; advertisers learn what works | Recall score ↑ across the network |
| Redemption attribution | Sales and pricing | Proof of CAC lets us charge more | Revenue per completed view ↑ |
| Receipt-level purchases | Targeting / CDP | Campaigns reach people who actually buy the category | eCPM ↑, merchant repeat rate ↑ |
| Fraud signals across sister apps | Risk | Shared bans, lower loss | Fraud loss as % of reward value ↓ |

Each loop has a number attached. If a loop cannot be stated this way, it is not a flywheel — it is a hope.

### 6.3 Correction one: sequencing

> *"We want to make profits but data is much more valuable."*

For YouTube and Google, data compounds because it improves an ad product already operating at billions of users. **At our scale, data has almost no value until there is volume** — a model trained on ten thousand watch sessions is worse than a sensible rule.

The sequence that works: **survival first, compounding second.** Revenue and retention are what buy the years during which data becomes valuable. A company that optimises for data collection before product-market fit ends up with a large, expensive, worthless dataset and no runway.

Concretely: through Phase 1, the data objective is **instrumentation, not exploitation** — capture cleanly, with consent, in a shape that will be usable later. Do not build ML, do not build a CDP, do not promise advertisers data products. Phase 2 is when the loops in §6.2 start turning.

### 6.4 Correction two: "never have issue with law in the process" 🔴

This is the one I would push back on hardest. Using data internally rather than selling it is **safer, but it is not a free pass**, and treating it as one is how this asset gets destroyed rather than compounded.

| Belief | Reality |
|---|---|
| "We don't sell it, so we're fine" | Indonesian PDP regulates *processing*, not just disclosure. Internal profiling is processing. |
| "We'll use it to improve our engines" | Not a lawful purpose statement. PDP requires purposes to be **specific and unambiguous**, disclosed *before* collection. "To improve our services" is the classic insufficient formulation. |
| "With consent we can do anything" | Australia's reform introduces a **"fair and reasonable" test that applies regardless of consent**. A use can be consented to and still unlawful. |
| "Anonymous viewers give free analytics" | Device fingerprints, IPs and behavioural traces are frequently personal information in both regimes. **Anonymous ≠ de-identified.** |
| "Receipt data is just shopping" | A pharmacy receipt implies health; a purchase pattern implies pregnancy, religious observance or financial distress. Some of that is **sensitive personal data** with stricter rules. |

**What to do instead, which costs little now and protects the asset:**

1. **Purpose-specific consent from day one** — each purpose separately toggleable, in plain Bahasa and English, versioned. This is already the consent service (YT-0036); it just has to be used properly rather than reduced to one checkbox.
2. **Anonymous analytics stay aggregate.** Reach, completion, geography, recall — cohort-level, no individual anonymous profiles, no cross-site tracking. Still genuinely valuable to a brand, and defensible.
3. **Advertisers receive audiences and aggregates, never rows.** "We share data with advertisers" should be architecturally false, not merely contractually discouraged.
4. **Receipt data is a separate consent**, opt-in, revocable, with a stated retention period — not bundled into signup.
5. **Purpose limitation enforced in code** — the consent service answers *"may I use this signal for this purpose?"* and the answer is load-bearing, not advisory.

Done this way, the data asset is **durable**. Done the other way, it is a contingent liability that evaporates the first time a regulator or a journalist looks closely — and in this market, PSE deregistration is a real and fast remedy.

## 7. What this changes in the plan

| Change | Where |
|---|---|
| Investor funding goes into the **reserve as pre-purchased inventory**, not a marketing budget | [`09`](09-points-economy-and-redemption.md) §5, unchanged mechanism |
| Launch slice narrows to **2–3 districts × 3–5 categories** | Supersedes "Jabodetabek" in [`16`](16-decisions.md) C1 |
| **Share mechanics** on voucher-earned and campaign pages | New tasks YT-0211, YT-0212 |
| Phase 1 data objective is **instrumentation, not exploitation** | [`04`](04-roadmap.md), reinforces the existing "no ML in P1" |
| Competitive watch is **GoTo / Shopee / Grab / TikTok Shop**, not Meta/Google | This doc |
| **Purpose-specific consent is a product feature**, not a compliance checkbox | [`03`](03-regulatory-and-risk.md), YT-0036 |
