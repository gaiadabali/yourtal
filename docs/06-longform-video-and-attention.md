# YourTal — Long-Form Video & Attention Verification

**Date:** 2026-09-18
**Why this doc exists:** campaign videos are **1–30 minutes**, not 15–30 seconds. That single fact changes the video subsystem, the fraud model, the pricing model and the user's own cost of participating. It deserves its own design.

---

## 1. The reference is YouTube, not Netflix

The earlier assessment (that we needed none of Netflix's machinery) was based on 15–30 second creatives. With 1–30 minute business-uploaded content, half of it comes back — but from a different company.

|                | Netflix's problem               | **YouTube's problem**                      | YourTal                                            |
| -------------- | ------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| Content source | Curated, few, professional      | **Uploaded by anyone, constantly**         | **Uploaded by every advertiser**                   |
| Access pattern | Hot catalogue, caches perfectly | **Long tail — most assets rarely watched** | **Long tail — most campaigns are small and local** |
| Hard cost      | Delivery of popular titles      | **Storage + encode of the tail**           | **Storage + encode of the tail**                   |
| Hard problem   | Rebuffer on a 2-hour film       | **Moderation at upload volume**            | **Moderation + brand safety + claims compliance**  |

So: we still don't need Open Connect appliances or per-shot encoding. We **do** now need an upload → moderate → encode → lifecycle pipeline, a cold-storage policy for the tail, and real cost control — which a world of 30-second creatives would not have required.

## 2. What it actually costs

### 2.1 Platform delivery cost (Cloudflare Stream, $1 / 1,000 delivered minutes)

Per-minute pricing is independent of bitrate, which is strongly in our favour for long-form.

| Video length | Delivery cost per completed view |
| ------------ | -------------------------------- |
| 1 min        | $0.001                           |
| 5 min        | $0.005                           |
| 15 min       | $0.015                           |
| **30 min**   | **$0.030**                       |

### 2.2 Storage ($5 / 1,000 stored minutes / month)

| Library                   | Stored minutes | Monthly    |
| ------------------------- | -------------- | ---------- |
| 500 campaigns × 10 min    | 5,000          | $25        |
| 5,000 campaigns × 10 min  | 50,000         | $250       |
| 50,000 campaigns × 10 min | 500,000        | **$2,500** |

Affordable, but only with a **lifecycle policy**: creatives for ended campaigns move to cold object storage (R2/S3) after 30 days and are re-ingested on demand. Without that policy, storage grows monotonically forever because advertisers never delete anything.

### 2.3 The user's cost — the constraint nobody budgets for

Indonesian users spend **IDR 50,000–100,000/month** on mobile data. At roughly IDR 3,000–5,000 per effective GB:

| Video length | Data @ 800 kbps (≈480p) | Cost to the user (ID) |
| ------------ | ----------------------- | --------------------- |
| 1 min        | 6 MB                    | ~IDR 24               |
| 5 min        | 30 MB                   | ~IDR 120              |
| 15 min       | 90 MB                   | ~IDR 360              |
| **30 min**   | **180 MB**              | **~IDR 720**          |

At 1080p (~3 Mbps) a single 30-minute view costs the user **675 MB — around IDR 2,700, or up to 5% of their monthly data budget on one ad.**

**Design rules that follow directly:**

1. **Default to 360–480p.** Cap at 720p. Let the user opt up explicitly; never let ABR climb on its own to 1080p on cellular.
2. **Show the data cost before playback** — _"≈120 MB · about 15 min"_. This is a trust feature in Indonesia, not a nicety.
3. **Download-on-Wi-Fi, watch-later** for anything over ~5 minutes. Prefetch long-form only on unmetered connections.
4. **Encode with AV1/H.265** where device support allows — 30–50% fewer bytes for the same quality, straight off the user's bill.
5. **Reward must dwarf data cost.** Rule of thumb: **reward value ≥ 20× the user's data cost.** A 30-minute view costing IDR 720 of data needs a reward worth **≥ IDR 15,000**. A IDR 50,000 voucher is ~70× — comfortable. Points worth IDR 2,000 would make watching a _net loss_ for the user once you count their time.
6. **Telco zero-rating is a real strategic play in Indonesia.** There is precedent — Telkomsel's VideoMax bundled streaming partners, and a well-documented "co-opetition" model between Telkomsel/Indosat/XL and streaming providers. A zero-rated YourTal watch session removes the single biggest objection to long-form in our proof-of-concept market. Worth a partnerships workstream, not just a note.

## 3. Nobody watches a 30-minute ad — unless the product makes them

This is the biggest product risk in the entire platform, and it is a design problem, not a marketing problem.

**Chapters + checkpoint rewards.** Split every long video into chapters with a reward released at each checkpoint. The user sees progress fill and value accrue rather than facing an undifferentiated 30-minute wall. **Superseded by decision O-1 (2026-09-20): the reward is given only on completing the full video and answering the questions. Abandoning at minute 12 earns nothing.** Chapters remain a progress and navigation device — the user still sees where they are and what is at stake — but progress is shown, not credited.

```
[====|====|====|====|====|====]  30 min, 6 chapters
  ✓    ✓    ✓    ●    ○    ○
 200  200  200  now  400  1000 pts   <- back-loaded so completion pays
                                        disproportionately
```

Back-load the curve: completing the last chapter should be worth more than the first three combined. That is what converts "sampled it" into "finished it."

**Resume across sessions.** A 30-minute commitment is unrealistic in one sitting on a phone. Server-side watch position, resume anywhere, and the reward accrues across sessions. Campaign-level expiry, not session-level.

**The checkpoint question is the key mechanic** (see §4) — it breaks the passivity that makes long video feel like a chore, and it is the same mechanic that verifies attention and delivers the survey.

**Set the right expectation at entry.** The card should say _"18 min · earn a IDR 50,000 Kopi Kenangan voucher · ~110 MB"_. The user is agreeing to a trade, explicitly. That framing beats any amount of autoplay trickery.

## 4. Questions: the business's tool, the fraud gate, and the research surface

**Confirmed requirement:** businesses author their own questions, shown at the end of the video (and optionally at checkpoints during it), and the reward is gated on answering them. The stated rationale — stronger brand impression, better recall, better conversion, at the cost of some user friction — is sound, and the trade is fair _provided the user is told the price before they start watching_.

This one mechanic does four jobs at once, which is why it is the most valuable thing in the product:

| Job                  | How                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| **Brand impression** | Active recall beats passive exposure. Answering a question about a claim is what moves it into memory. |
| **Fraud gate**       | A farm must now genuinely process the video's content, not just let a clock run.                       |
| **Measurement**      | "82% of viewers correctly recalled your key claim" is a product Meta cannot sell. Price it as a tier.  |
| **Research surface** | The same delivery path can carry paid third-party survey questions later, under their own disclosure.  |

### 4.1 Authoring — what the business can and cannot do

In the campaign console, the business builds a **question bank** per campaign:

| Type                               | Use                              | Scored?                    |
| ---------------------------------- | -------------------------------- | -------------------------- |
| Multiple choice (one correct)      | Recall of a fact or claim        | Yes                        |
| True / false                       | Quick comprehension              | Yes                        |
| Rating / Likert                    | Brand sentiment, purchase intent | No — opinion               |
| Ranked preference                  | Feature or product preference    | No — opinion               |
| Short free text (optional, capped) | Open feedback                    | No — sampled for reporting |

**Hard platform guardrails — enforced, not advisory:**

- **Maximum 3–5 questions** per campaign, hard-capped by video length (e.g. 1 question per 5 minutes, max 5).
- **No personal data collection in questions.** No phone, email, address, ID number, income, health status. Businesses _will_ try to turn the quiz into a lead-capture form; the authoring UI must reject it and a moderator must review the bank alongside the video. Lead generation is a separate, explicitly-consented campaign type with its own flow — not something smuggled into a reward gate.
- **No questions unanswerable from the video.** Reviewed at moderation; also caught automatically by accuracy telemetry (see 4.3).
- **Question bank must be ≥ 3× the number asked** — this is the anti-sharing requirement, and it is enforced at campaign approval, not suggested.
- Questions are moderated **with the video**, and are versioned: editing a live bank creates a new version and resets its accuracy baseline.

### 4.2 Scoring policy — gate on _answering_, scale on _correctness_ 🚩

**Strong recommendation:** do **not** hard-fail a user who watched 28 minutes and got 2 of 4 right. That is where you lose the user permanently, earn the review that kills web-app acquisition, and generate a support queue nobody budgeted for.

```
  completion reward   ──  granted for watching + answering (the fair trade)
+ accuracy bonus      ──  scales with correct answers, 0-100%
= total reward

  e.g.  base 60% of advertised value for completing and answering
        + up to 40% more for accuracy
        with the campaign card showing "earn up to IDR 50,000"
```

This keeps every incentive pointing the right way: the user must genuinely watch to earn the _full_ reward, the business gets real recall data, and nobody who honestly sat through 30 minutes walks away with nothing. Businesses who want a hard pass threshold can have one — as a campaign setting, with the threshold **disclosed on the card before the user starts**, and with at least one retry.

**Never change the terms after the watch begins.** The reward rule shown at entry is the rule that is honoured, even if the campaign is edited mid-flight.

### 4.3 The answer-sharing problem — plan for it now, not after

Within a week of launch, `jawaban YourTal` will be a Telegram channel and a search result. This is not a risk, it is a certainty. Countermeasures, all cheap if built in from the start:

| Defence                                                    | Effect                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Per-user random subset** from a bank ≥3× the asked count | A shared answer key covers a fraction of what any given user sees                                                  |
| **Shuffled option order** per user per attempt             | Screenshot answer keys ("pick C") become useless                                                                   |
| **Randomised checkpoint timestamps**                       | The client cannot precompute when a question lands                                                                 |
| **Per-question timer** (~20–30 s)                          | Ample for a viewer, tight for looking up an external list                                                          |
| **Opinion questions mixed in**                             | Have no shareable "correct" answer, and still produce data the business wants                                      |
| **Automatic bank rotation**                                | Retire and refresh questions on a schedule and on anomaly                                                          |
| **Accuracy anomaly detection**                             | A question whose population accuracy jumps from 61% → 97% overnight is leaked — auto-retire it and flag the cohort |
| **Answer-pattern clustering**                              | Accounts answering identical rotated subsets with identical latencies are one operator                             |

The last two matter most: **assume the key leaks, and detect it fast.** A system that rotates and self-heals beats one that tries to stay secret.

### 4.4 Reporting back to the business

Per campaign: completion rate by chapter (where they dropped off), per-question accuracy distribution, sentiment/intent aggregates, recall score, and reward-to-redemption conversion. Aggregate only — never per-user answers tied to an identity, in either jurisdiction.

## 5. Attention verification — the checkpoint mechanic

A 30-minute view is worth 60× a 30-second view to a fraudster. A device farm that can fake completions can extract far more per device. Simultaneously, a business paying voucher-scale money per view will demand proof that a human actually watched.

**One mechanic solves both, plus a third thing:**

```
      chapter 1          chapter 2          chapter 3
 ┌──────────────┬───┬──────────────┬───┬──────────────┬───┐
 │              │ ? │              │ ? │              │ ? │
 └──────────────┴───┴──────────────┴───┴──────────────┴───┘
                  ▲                  ▲                  ▲
       randomised checkpoint    randomised         randomised
       - tap to continue        - content Q        - brand/opinion Q
       - server-issued token    - answer scored    - sells as research
```

Each checkpoint:

- appears at a **server-chosen, randomised timestamp** the client cannot predict,
- requires an interaction the client cannot precompute (a question whose answer is only in the video, or a positional tap),
- exchanges a **per-checkpoint signed token** (not one token for the whole video) for the chapter's reward,
- records response latency and input entropy as behavioural signals.

**Three jobs, one mechanic:**

| Job             | How the checkpoint does it                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Fraud**       | A farm must now genuinely process video content at randomised points, not just let a clock run. Raises attack cost by orders of magnitude.                                     |
| **Survey**      | Some checkpoints are the "masked" questions — one at a time, in context, conversational. Exactly the low-bounce delivery the brief asked for, with honest disclosure attached. |
| **Measurement** | Comprehension and recall data is a _product_. "82% of viewers correctly recalled your key claim" is something a business will pay extra for, and Meta cannot sell it.          |

**Supporting enforcement:**

- Foreground + screen-on + audio-focus required; reward accrual pauses on backgrounding.
- Playback position reported server-side and cross-checked against CDN delivery logs — a client claiming minute 22 that only pulled 4 minutes of segments is lying.
- Playback rate locked (no 3× speedrun) for reward-bearing sessions.
- Per-user concurrency limit of one reward-bearing session at a time.

## 6. Ingest & moderation pipeline

```
 advertiser upload
        │
        ▼
 ┌─────────────────┐   virus/format scan, duration & size limits, hash dedupe
 │  INGEST         │   (identical creative re-uploaded → reuse the encode)
 └────────┬────────┘
          ▼
 ┌─────────────────┐   ASR transcript · frame sampling · OCR on-screen text
 │  MODERATION     │   LLM policy screen (claims, restricted categories,
 │  automated      │   competitor/IP, adult, violence) → per-timestamp flags
 └────────┬────────┘
          ▼
 ┌─────────────────┐   human reviews ONLY flagged timestamps, not 30 minutes
 │  HUMAN QUEUE    │   SLA target: < 4 business hours
 └────────┬────────┘
          ▼
 ┌─────────────────┐   ABR ladder capped at 720p · AV1/H.265 where supported
 │  ENCODE         │   chapter markers · thumbnails · checkpoint candidates
 └────────┬────────┘   auto-proposed from transcript+scene changes
          ▼
 ┌─────────────────┐   hot (CDN) → warm (30d) → cold archive
 │  PUBLISH        │   restricted-category campaigns carry jurisdiction flags
 └─────────────────┘
```

**Moderation is a compliance control, not a quality gate.** Both markets restrict advertising of alcohol, gambling, therapeutic goods, financial products and advertising to children — and a 30-minute video has far more room to make an unlawful claim than a 15-second one. The reviewer must see flagged timestamps with transcript context, never be asked to watch the whole thing.

**Hash-dedupe at ingest** matters more than it looks: advertisers re-upload the same file across campaigns constantly, and encoding the same asset five times is pure waste.

## 7. Pricing implication — this is CAC, not CPM

With 30-minute videos and business-funded rewards, we are no longer price-takers against AdMob. The comparison a business should make is **cost per acquired customer**, not cost per thousand impressions.

**Benchmarks for context:** programmatic video CPCV averages **$0.04**; mobile video **$0.01–0.05**; YouTube CPV ~**$0.024**; CTV **$0.15–0.40** (CTV earns its premium on 78% completion vs 54% mobile).

A YourTal completed 30-minute view with a verified-comprehension checkpoint and a voucher that requires a store visit to realise is **not the same unit** and must not be sold at the same price.

**Illustrative deal (Indonesia):**

| Line                                                     | Amount                  |
| -------------------------------------------------------- | ----------------------- |
| Voucher face value to the user                           | IDR 50,000              |
| Voucher real cost to the business (70% margin)           | IDR 15,000              |
| YourTal cash fee per **verified completed view**         | IDR 10,000              |
| **Business cost per engaged, verified, 30-min prospect** | **IDR 25,000 (~$1.56)** |
| YourTal delivery cost                                    | ~IDR 480 ($0.03)        |
| **YourTal gross margin per view**                        | **~IDR 9,500**          |

Against Indonesian Meta/Google CAC for a considered purchase (commonly IDR 50,000–200,000), IDR 25,000 for someone who watched 30 minutes _and_ must visit the store to redeem is a strong pitch — and the voucher redemption is itself the conversion event, which is the measurement Meta cannot provide.

**This is a material correction to the earlier economics.** The first analysis concluded that video could not fund rewards in Indonesia. That was true _for ad-network CPM pricing on short creatives_. With direct-sold long-form priced against CAC and rewards funded from merchant inventory, the watch session becomes the primary revenue engine, not merely the engagement surface. Surveys and offers remain valuable but drop from #1 to a complement.

**The risk moves with the model:** it now rests entirely on **whether users will actually watch, and whether businesses will actually pay per completed view.** Both are testable in weeks with a manual pilot — and both should be tested before a line of decisioning code is written.

## 8. Format mix — do not build for 30 minutes only

| Format        | Length    | Reward scale                  | Role                                                              |
| ------------- | --------- | ----------------------------- | ----------------------------------------------------------------- |
| **Quick hit** | 15–60 s   | points only                   | Daily habit, fills the feed, programmatic backfill                |
| **Standard**  | 1–5 min   | points, small voucher         | The workhorse — most campaigns will live here                     |
| **Deep dive** | 5–15 min  | voucher                       | Considered purchases: property, finance, auto, education, health  |
| **Feature**   | 15–30 min | premium voucher / merchandise | Rare, high-value, tentpole. Chaptered and resumable by necessity. |

Expect the **1–5 minute band to carry most inventory**, with 15–30 minute features as the headline capability that differentiates the platform. Build the chapter/checkpoint/resume machinery once and let all four formats use it.
