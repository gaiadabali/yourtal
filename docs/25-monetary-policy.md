# YourTal — Monetary Policy, Decided

**Status:** ✅ **`P_issue`, both backing rates and expiry are DECIDED, 2026-09-21.** Faucet rates remain — see §8. **Expiry changed 2026-09-25: off in both regions** (founder, F2 and F18 in TASKS.md); it stays built and switchable per region in the staff console. **Two things to read before the rest: §5, because setting these numbers made a dormant compliance breach live; and §9, because the founder changed the IDR storage unit on 2026-09-22 to follow the payment gateway, reversing the sen decision.**

**Owner:** The founder holds the economy (**YT-0050**, decided 2026-09-21).
**Ticket:** **YT-0048**. Depends on **YT-0012**, signed at development stage 2026-09-21.

> ⚠️ **§9 does not lift §5's breach.** `B` (ID) is **IDR 6/point**, and the constant in the browser is `600` sen — **the same economic fact in the older unit.** The unit change does not touch the leak, and when the migration lands and that constant becomes `6`, it will still be the live backing rate sitting in a client bundle. The fix is YT-0589's `apps/web` half, not arithmetic.

`docs/09` §6 is the _design_ — why faucets need sinks, which levers exist and in what order of pain. **This document is the _decision_:** what the parameters actually are, what happens when they change, and the compliance bound they must never cross. Design explains; this commits.

---

## 1. Why these were blank until the owner filled them

This document was written on 2026-09-21 with `P_issue` and both backing rates **deliberately left empty**, and they stayed empty for a few hours until the economy owner set them. The reason matters more than the delay, and it should govern the next blank too:

Earlier the same day a two-person approval control was found guarded by `MATERIAL_SETTLEMENT_DECREASE_THRESHOLD = 0.2` — a number an agent had invented as a loudly-commented placeholder so the check would not be a no-op. That was correct engineering behaviour, and it still left **a number nobody had decided standing in front of a control that protects users**. It was removed rather than ratified.

`B` is that failure with far more reach. It does not guard one control — **it prices the entire catalogue**, because `points_price = (S / B) × demand_multiplier`. A placeholder `B` does not sit inertly waiting to be replaced; it propagates into every price the moment anything reads it.

**And the propagation turned out to be the live risk, not a hypothetical one.** The owner set `B` to the value the code already held, which is why the decision cost no reprice and no migration — and that same property published the real backing rate to browsers the instant it was recorded. **See §5.** The blanks were doing more work than anyone realised: they were the only thing making the existing leak harmless.

**The remaining blank is faucet rates (§8)**, and the same rule applies — they are proposed there, derived from a ceiling the founder has already set, and not written into §2 until he picks a point beneath it.

---

## 2. The parameters

| Parameter               | Value                        | Notes                                                                                                                                                    |
| ----------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`P_issue`** (ID)      | **IDR 9/point**              | ✅ Decided 2026-09-21. Raised from `docs/09`'s illustrative IDR 8 to widen margin **without touching `B`**. Restated in whole Rupiah 2026-09-22 — see §9 |
| **`B`** (ID)            | **IDR 6/point**              | ✅ Decided 2026-09-21. **Margin 33%.** Restated in whole Rupiah 2026-09-22; the _value_ is unchanged, the _unit_ is                                      |
| **`B`** (AU)            | **3 cents/point**            | ✅ Decided 2026-09-21. ~167 points per AUD 5; a AUD 20 voucher costs ~667 points. **Unchanged by §9** — Stripe already takes AUD in cents                |
| **`demand_multiplier`** | **`1.0`**                    | Fixed at launch. Bounded 0.8–1.25 (YT-0130). Nothing moves it yet                                                                                        |
| **Currency unit**       | **whole Rupiah / AUD cents** | ⚠️ **CHANGED 2026-09-22 for IDR — follow the gateway.** IDR exponent **0**, AUD exponent **2**. See §9; this reverses the 2026-09-20 sen decision        |
| **Rounding**            | **Always up**                | Rounding down sells below backing in the same direction every time, so the shortfall accumulates rather than averaging out                               |
| **`B < P_issue`**       | **Enforced**                 | A CHECK constraint, not a convention. The spread is the margin and it cannot be set away                                                                 |
| **Expiry**              | **Off in both regions**      | ⚠️ Changed 2026-09-25 (F2, F18). Built and switchable per region; when on, it is the 12-month rolling rule in §3. With it off, ID-1 loses a leg — §3     |

**Two structural facts already hold and must keep holding**, because ID-1 rests on them: `B` lives in the `ledger` schema, which `yourtal_app` **cannot read at all**, so the store service physically cannot compute a price even on purpose; and no user may ever purchase points.

### The illustrative values are not a default

`docs/09` §4.1's worked example (`P_issue` = IDR 8, `B` = IDR 6) and `packages/contracts/src/money/mock-backing-rate.ts` (`600` sen, `3` AUD cents) agree with each other. **That agreement is a coincidence of authorship, not a decision** — and it is exactly what makes them dangerous to adopt by default. If the owner chooses those numbers, they should be chosen, and this table should say so.

---

## 3. Expiry

> **Changed 2026-09-25: expiry is off in both regions** (founder, F2 and F18). The mechanism below is still built, and switching it on for a region in the staff console applies it. **With expiry off, ID-1 rests on three of its four features** (no purchase, no transfer, no published cash rate), which is weaker than the position this section describes. That is recorded in `docs/24` and must be reviewed with counsel before the first real Indonesian user.

Expiry is the platform's largest sink after redemption, and it is the one lever with a **legal floor rather than a commercial one**:

- **Australia** — consumer guarantees apply to goods obtained with points (**AU-4**). Gift-card expiry minimums exist in Australian law and a points expiry short enough to look like a gift-card expiry will be read as one.
- **Indonesia** — expiry is one of the four features that make points a loyalty currency rather than e-money (**ID-1**). **Removing expiry weakens the single largest legal position in the plan.**

So expiry is bounded on both sides: too short is a consumer-law problem in AU, too long — or absent — is an e-money problem in ID.

### ✅ Decided 2026-09-21: **12 months from the account's last activity**

**Rolling, not fixed.** Any earn or any redemption resets the clock. A user who uses the product never loses points; a dormant account's points expire twelve months after it went quiet.

**Why the rolling mechanism matters more than the number.** It is the distinction from a gift card, and it is what makes this defensible on both sides at once:

- **A gift card expires from purchase, regardless of use** — that is the thing Australian law sets minimum terms for. Points that expire from _inactivity_ are a different instrument, and the resemblance AU-4 would otherwise invite is weakened by the mechanism rather than by argument. A fixed 12-month expiry would have looked exactly like a short gift card; this does not.
- **ID-1 needs expiry to exist and to be real.** It does: dormant balances genuinely lapse, so the feature the position rests on is present rather than nominal. Twelve months is short enough that it bites, which a 24- or 36-month term would not.

**What this obliges the product to do**, and none of it is built yet:

- **`last_activity_at` per account becomes a monetary field, not a telemetry one.** It determines when value is destroyed, so it must be written in the same transaction as the earn or redemption that resets it — not derived later from an event stream, and not best-effort.
- **Expiry dates are shown before they matter, not after** — already a criterion of YT-0174.
- **Expired points are a ledger event, not a deletion.** Breakage is income; it posts.
- **The warning path is a product obligation.** A balance that lapses with no notice is the version of this that generates complaints, whatever the terms say.

**Still to state in YT-0015's consumer copy**, in both languages and plainly: that the clock is activity-based, what counts as activity, and what notice is given before a lapse.

---

## 4. Devaluation playbook

`docs/09` §6 ranks adjusting `B` as lever 3 and says _"announce it, never do it silently."_ This is what "announce it" means, so that it is a procedure rather than an intention.

**A devaluation is any change that raises the points price of an unchanged item** — most directly a reduction in `B`, but also a demand-multiplier increase held long enough to look permanent. It is the same event to a user either way, and the test is the user's experience, not the mechanism.

1. **Try levers 1 and 2 first, and record that you did.** Adding inventory solves the actual problem with no user-visible pain; a targeted multiplier change is low pain. Reaching for `B` without having tried these is the step to justify.
2. **Two people, always.** This is the catalogue-wide analogue of the settlement-decrease control (**YT-0574/0576**), where the founder's decision was that _any_ downward change needs two-person approval with no threshold. A change to `B` is strictly larger in blast radius than a change to one listing's `S`, so it cannot have a weaker bar.
3. **Announce before, never after.** State what is changing, by how much, and from when. A user discovering a devaluation by finding that yesterday's basket now costs more is the failure mode this whole section exists to prevent.
4. **Honour the old rate for anything already shown.** A price shown is locked for 15 minutes (**YT-0049**); a devaluation does not shorten that window.
5. **Never publish `B` itself.** Announce the _effect_ — "this reward now costs N points" — never the rate. See §5; publishing the rate is an ID-1 breach, and a devaluation announcement is the most tempting moment to do it.
6. **Record it here**, with the date, the before and after values, which levers were tried first, and who the second approver was.

| Date | `B` before | `B` after | Levers tried first | Approved by |
| ---- | ---------- | --------- | ------------------ | ----------- |
| —    | —          | —         | —                  | —           |

---

## 5. ID-1 compliance bound — **currently failing**

**The rule:** no fixed consumer rate is ever published, and `B` never appears in a user-facing surface (`docs/24`, position **ID-1**). This is not a preference. ID-1 is _the_ position that keeps YourTal Points a loyalty currency rather than e-money, and "there is no published fixed cash rate" is one of the four features it rests on.

> ❌ **This bound is breached today.** `MOCK_BACKING_RATE_IDR_SEN_PER_POINT` and `MOCK_BACKING_RATE_AUD_CENTS_PER_POINT` reach the browser. The chain is static and does not depend on which build is current: `apps/web/features/console/campaign-builder/campaign-editor-reward.tsx:1` is `"use client"`; `:10` imports `./campaign-reward-risk`; that imports both rates at `:33-35` and uses them at `:73-74`; there is no `server-only` anywhere on the path. Found by `yourtal-b6` under **YT-0589**, verified independently.

> 🚨 **As of 2026-09-21 this is no longer theoretical, and nobody wrote a line of code to make it real.** The decided rates are **`B` (ID) = 600 sen** and **`B` (AU) = 3 cents**. The constants in the browser are `MOCK_BACKING_RATE_IDR_SEN_PER_POINT = 600` and `MOCK_BACKING_RATE_AUD_CENTS_PER_POINT = 3` (`mock-backing-rate.ts:39,42`). **They are the same numbers.** Holding `B` at the value already in the code is exactly what made the decision cheap — no reprice, no migration — and it is the same property that turned a harmless placeholder into the live backing rate, shipped to browsers, the instant the decision was recorded.
>
> This is the failure mode predicted two paragraphs below, arriving by **decision rather than by edit** — which is worse, because there was no commit to review and no test to fail. **The word "mock" in that filename is now false**, and a file named `mock-backing-rate.ts` is the last place anyone will look for a live compliance breach.
>
> **Two things, in order:** rename or relocate the constant so the real rate does not live in a file called `mock`, and close **YT-0589**'s `apps/web` half so it does not reach the client graph at all. The direction is known — `assessRewardToDataCost` needs a _ratio_, not the rate, so passing the computed points price and the data-cost estimate removes `B` from the browser without losing the feature.

**Until today the exposure was low, because it was the mock rate — an invented number.** The finding is the _pattern_: the module exists to centralise the rate, so when this document's blanks are filled, **the obvious maintenance action is to update that constant** — and the real `B` reaches browsers with nothing failing, because every consumer agrees with it. **A leak that arrives through the correct maintenance action is worse than one that arrives through a mistake.**

**So this is a precondition, not a follow-up: YT-0589's `apps/web` half must close before `B` is set here.** The blanks are load-bearing in both directions — they are why the breach is currently harmless, and filling them is what would make it real.

Two further bounds, both already holding and both easy to lose:

- **No public surface may expose a value invariant across listings and equal to a platform economic constant.** `faceValueIdr / priceInPoints` varies per listing and is fine — that is a shopper comparing offers. `S / priceInPoints` collapses to the same number on every row, which is what makes it a _published fixed rate_. Closed for the store catalogue by `publicListingSchema`, which **cannot express** `settlementValueIdr` rather than having it stripped per route.
- **`B` is server-side only and must never reach a response body.** A test at the contract boundary, not per route — a route test would have passed the client-bundle leak above.

---

## 6. The daily review

`docs/09` §6 already specifies what the economy owner looks at each morning, and it is adopted here unchanged as the agreed checklist (**YT-0050**):

issuance rate vs redemption rate · points outstanding and its growth · coverage ratio · average realised value per point · days-to-first-redemption · catalogue depth by price band · share of outstanding points held by the top 1% of holders.

**None of it is instrumented yet.** The coverage ratio is measured from ledger projections and never a stored total (**YT-0130**), and the rest needs the event schema (**YT-0059**) and the economy dashboard (**YT-0307**). Until then the checklist is a specification of what to build, not a routine anyone can perform — and it should not be recorded as a working control.

---

## 7. What closes this document

| Needed                           | From                                            |
| -------------------------------- | ----------------------------------------------- |
| `P_issue`, `B` (ID), `B` (AU)    | The economy owner — **the founder**             |
| Expiry, set against `docs/24`    | The economy owner, with AU-4 and ID-1 open      |
| Faucet rates per action          | Follows `P_issue`; each is a cash cost at issue |
| YT-0589's `apps/web` half closed | Before `B` is set, not after                    |

---

## 8. Faucet rates — the remaining blank

`docs/09` §6 lists the faucets; **none of them has a rate**. That is the last unset thing in this document, and unlike `B` these can be _derived_ rather than chosen, because the founder has already fixed the anchor.

**The anchor:** a twenty-minute campaign rewards **less than AUD 5** — the founder's stated position, and explicitly _a reward rather than wage replacement_, so the figure is a ceiling and not a target. At `B` (AU) = 3 cents/point that is **fewer than 167 points** for a completed twenty-minute view.

| Faucet                  | Proposed                    | Derivation                                                                   |
| ----------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| Completed campaign view | **~6 points per minute**    | 120 points for 20 minutes = AUD 3.60 — inside the AUD 5 ceiling with room    |
| Accuracy bonus          | **+25% of the view reward** | Rewards attention without making the base view feel like a consolation prize |
| Daily check-in / streak | **Small and fixed**         | Escalating and deterministic (YT-0177), never chance-based — red line 1      |
| Referral                | **Unset**                   | A referral's value is a CAC question, not a monetary-policy one              |
| Promotional grants      | **Cash-backed at issue**    | Rule K6. Not a rate — a constraint, and the one an unfunded faucet breaks    |

**These are proposals, not decisions, and they are deliberately not written into the table in §2.** They follow arithmetically from the AUD 5 ceiling and `B`, so they are a much smaller ask than `B` was — but _"less than AUD 5"_ is a ceiling, and picking the point beneath it is a judgement about generosity that belongs to the economy owner.

**One structural rule that is not negotiable regardless of the rates:** every faucet is a **cash cost at the moment of issue**, funded from the reserve. An unfunded faucet drives the coverage ratio down, and YT-0130's test proves exactly that — it funds a purchase, grants against it, then grants marketing points with no cash behind them and watches the ratio fall. **The rate is a commercial choice; the funding is not.**

---

## 9. Storage unit follows the gateway — founder decision, 2026-09-22

**Each currency is stored in the unit its own payment gateway speaks.** Not one platform-wide convention, and not ISO 4217 where the gateway disagrees with it.

| Currency | Gateway                           | Unit         | Exponent | Change                                                |
| -------- | --------------------------------- | ------------ | -------- | ----------------------------------------------------- |
| **IDR**  | **Xendit** (`docs/04`, `docs/07`) | whole Rupiah | **0**    | ⚠️ **was 2 (sen)** — reverses the 2026-09-20 decision |
| **AUD**  | **Stripe** (`docs/04`, `docs/07`) | cents        | **2**    | none — Stripe already takes AUD in cents              |

**Only IDR moves.** The instruction was to follow the gateway "for IDR and AUD", and AUD already did: Australia's gateway is Stripe, Stripe expresses AUD in cents, and `MINOR_UNIT.AUD` is already exponent 2 `confirmed`. So the AUD half of the decision is satisfied by changing nothing, which is worth stating so nobody migrates it for symmetry.

### What this reverses, and on what basis

It reverses **YT-0506's 2026-09-20 decision to store IDR in sen**, and the migration that shipped it (`20260920000011_idr_sen.sql`). That decision was well argued — ISO 4217 gives IDR a sen minor unit, Indonesian banking writes `Rp 1.000,26`, and Stripe treats IDR as two-decimal. **The founder has chosen the gateway's convention over the standard's**, on the grounds that the gateway is what the money actually passes through.

⚠️ **This rests on an inference, and that is recorded deliberately.** Xendit's documentation **never states its IDR unit in words**. The finding is three consistent signals: `request_amount` typed as a plain `number` with every IDR example a whole-Rupiah figure, a minimum QR transaction of **1 IDR** (which would be Rp 0.01 if the field were sen), and no minor-unit convention documented anywhere. **High confidence, not certain.** The founder was offered a sandbox confirmation first and chose to proceed without it. A sandbox charge observing what `45000` costs would settle it, and remains the cheapest way to be sure.

### The 100× hazard inverts, and that is the thing to watch

Before this decision, storage was sen and Xendit takes Rupiah, so a driver that failed to convert **over-sent by 100×**: a Rp 45,000 payout leaving as Rp 4,500,000.

After it, storage and Xendit agree — but `packages/drivers` still defaults `declaredMinorUnitExponent.IDR` to `2`. **A driver taking that default now under-sends by 100×**: the same payout leaving as Rp 450. The defect does not go away, it changes sign, and it becomes quieter: an undercharge looks like a pricing bug rather than an incident.

**The fix is unchanged and now more clearly right: give IDR no default at all.** Each driver declares what its provider speaks, because with two gateways on two conventions there is no longer any defensible platform-wide default to fall back on.

### What has to move

Scoped from the surfaces already audited on 2026-09-21/22. **None of this is `economy`'s to execute** — it spans `platform`, `value` and `web`, and it should land as one unit behind a drift test, exactly as the sen migration did.

1. `MINOR_UNIT.IDR` exponent **2 → 0**, with the evidence rewritten to cite the gateway rather than ISO.
2. A migration **÷100 on every IDR row** — catalogue and IDR-scoped ledger — the mirror of `20260920000011_idr_sen.sql`, carrying the same guard that refuses if an AU-merchant row is present.
3. `rupiah()` and `audCents()`: `rupiah()`'s meaning changes, `audCents()`'s does not.
4. `mock-backing-rate.ts`: `MOCK_BACKING_RATE_IDR_SEN_PER_POINT = 600` → **6**, and the name stops saying `SEN`. The AUD constant is untouched.
5. Pricing engine: `B` in micros-per-point **600_000_000 → 6_000_000**, and `price_test.go`'s worked comments, which state the sen figure explicitly.
6. **The daily Merkle proofs are invalidated again**, for the same reason as last time: rewriting `amount_minor` invalidates every root over it. Delete-and-rebaseline in development; a signed re-baselining with the old roots archived in production.
7. `public-jsonld.ts` needs **no change** — it already scales by `MINOR_UNIT` rather than a literal, which is exactly the property that made it safe to move the unit twice.

**And the reason it is cheap to do twice**: YT-0506's migration put the ×100 in one place and replaced ~90 bare literals with `rupiah()` / `audCents()`. That work is what makes this reversal a unit change rather than a ninety-site edit — the previous decision paid for the ability to undo it.
