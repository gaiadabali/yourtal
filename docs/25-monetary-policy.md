# YourTal — Monetary Policy, Decided

**Status:** ⚠️ **DRAFT — three numbers pending the economy owner.** Everything that is a design decision is settled here; everything that is a number the founder must choose is marked **`________`** and deliberately not invented.
**Owner:** The founder holds the economy (**YT-0050**, decided 2026-09-21).
**Ticket:** **YT-0048**. Depends on **YT-0012**, signed at development stage 2026-09-21.

`docs/09` §6 is the _design_ — why faucets need sinks, which levers exist and in what order of pain. **This document is the _decision_:** what the parameters actually are, what happens when they change, and the compliance bound they must never cross. Design explains; this commits.

---

## 1. Why the blanks are blanks

Three values below are unset. They are unset **on purpose**, and the reason is a defect this project removed on 2026-09-21: a two-person approval control had been guarded by `MATERIAL_SETTLEMENT_DECREASE_THRESHOLD = 0.2`, a number an agent invented as a loudly-commented placeholder so the check would not be a no-op. It was correct engineering behaviour and it left **a number nobody had decided standing in front of a control that protects users**. It was removed rather than ratified.

`B` is that failure with far more reach. It does not guard one control — **it prices the entire catalogue**, because `points_price = (S / B) × demand_multiplier`. A placeholder `B` does not sit inertly waiting to be replaced; it propagates into every price the moment anything reads it. So it stays blank until the owner sets it.

**What is not blank:** every policy, bound, playbook and compliance rule below. The blanks are three scalars, not the work.

---

## 2. The parameters

| Parameter               | Value           | Notes                                                                                                                      |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **`P_issue`** (ID)      | **`________`**  | Average price a partner pays per point, in **sen**. `docs/09` §4.1 uses IDR 8/point illustratively                         |
| **`B`** (ID)            | **`________`**  | Backing rate, in **sen** per point. `docs/09` §4.1 uses IDR 6/point illustratively                                         |
| **`B`** (AU)            | **`________`**  | Backing rate in **cents** per point. No illustrative value exists; AU is the primary market                                |
| **`demand_multiplier`** | **`1.0`**       | Fixed at launch. Bounded 0.8–1.25 (YT-0130). Nothing moves it yet                                                          |
| **Currency unit**       | **sen / cents** | IDR stored in **sen** — founder decision 2026-09-20 (YT-0506). Banking uses it; matches ISO 4217                           |
| **Rounding**            | **Always up**   | Rounding down sells below backing in the same direction every time, so the shortfall accumulates rather than averaging out |
| **`B < P_issue`**       | **Enforced**    | A CHECK constraint, not a convention. The spread is the margin and it cannot be set away                                   |
| **Expiry**              | **`________`**  | See §3 — this one has a legal floor, not just a commercial answer                                                          |

**Two structural facts already hold and must keep holding**, because ID-1 rests on them: `B` lives in the `ledger` schema, which `yourtal_app` **cannot read at all**, so the store service physically cannot compute a price even on purpose; and no user may ever purchase points.

### The illustrative values are not a default

`docs/09` §4.1's worked example (`P_issue` = IDR 8, `B` = IDR 6) and `packages/contracts/src/money/mock-backing-rate.ts` (`600` sen, `3` AUD cents) agree with each other. **That agreement is a coincidence of authorship, not a decision** — and it is exactly what makes them dangerous to adopt by default. If the owner chooses those numbers, they should be chosen, and this table should say so.

---

## 3. Expiry

Expiry is the platform's largest sink after redemption, and it is the one lever with a **legal floor rather than a commercial one**:

- **Australia** — consumer guarantees apply to goods obtained with points (**AU-4**). Gift-card expiry minimums exist in Australian law and a points expiry short enough to look like a gift-card expiry will be read as one.
- **Indonesia** — expiry is one of the four features that make points a loyalty currency rather than e-money (**ID-1**). **Removing expiry weakens the single largest legal position in the plan.**

So expiry is bounded on both sides: too short is a consumer-law problem in AU, too long — or absent — is an e-money problem in ID. **It must be set with `docs/24` open**, and it is the one blank here that should not be filled from commercial intuition alone.

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

**Today the exposure is low, because it is the mock rate — an invented number.** The finding is the _pattern_: the module exists to centralise the rate, so when this document's blanks are filled, **the obvious maintenance action is to update that constant** — and the real `B` reaches browsers with nothing failing, because every consumer agrees with it. **A leak that arrives through the correct maintenance action is worse than one that arrives through a mistake.**

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
