# Phase 0 · Value layer, economy, risk, web foundations

The part that must never be wrong. Nothing here is user-visible; all of it gates Phase 1.

---

## Value

### YT-0041 · Ledger schema and constraints
`review` · P0 · value · 4d · dep: YT-0516

- Re-parented onto the local stack (YT-0516): this needed _a_ service, not a _managed_ one. The cloud task now covers deployment only.
- [x] `account` / `entry` / `transfer` tables; entries append-only, no UPDATE or DELETE grant
- [x] DB-level `CHECK` that a transfer's entries sum to zero
- [x] `idempotency_key UNIQUE` on transfer; amounts are integer minor units, never float
- [x] **IDR unit is CONTESTED — see YT-0506.** This AC currently mandates sen; `packages/contracts` explicitly forbids it. Do not implement the ledger until YT-0506 is decided, or the 100× error this AC warns about is the one we ship
- [x] **Already built and proved by YT-0518** — `ledger.account`, `transfer`, `entry`, the deferred balance trigger, append-only grants, 10 tests against real Postgres. Marked on what exists rather than built twice

### YT-0513 · Currency-tagged Money type
`doing` · P0 · value · 3d · dep: —

- [x] Adopt Fowler's `(int64 amount_minor, currency)` per `docs/12` §3 — `moneySchema` in `packages/contracts/src/money/money-value.ts`, with currency-checked `addMoney` / `subtractMoneyClamped` / `compareMoney`. Published to OpenAPI as `Money` and `Currency`, so Go has the type before the wire needs it (`AmountMinor int64`, the int-width widening held)
- [x] **AUD proceeds while IDR stays blocked** — `assertUnitSettled(currency, operation)` passes AUD and throws `UnsettledMinorUnitError` for IDR. Enforced, not remembered
- [x] Turns "IDR is stored in X" into a **declared property** — `MINOR_UNIT` in `minor-unit.ts` records AUD as exponent 2 `confirmed` and IDR as exponent 0 `provisional`, with its evidence. This is the table YT-0537's parity test compares a PSP driver against
- [x] `formatMoney(amountMinor, currency)` now derives its divisor from `MINOR_UNIT` instead of a literal `/ 100`; `formatMoneyValue(money)` is the one-argument form for amounts that carry their own currency. Rendered output is unchanged and asserted to be
- [x] 40 new tests, contracts 299 → 339, `pnpm verify` green across all 18 tasks

**A phantom type would not have worked, and that is the finding.** The cheap version of this ticket is a compile-time tag, `Money<"AUD">` vs `Money<"IDR">`, erased at build. It would have caught nothing, because **no core schema carries a currency or a region**: `listingSchema`, `voucherSchema` and `campaignSchema` are all currency-free, and `REGION_CONFIG` maps region→currency with nothing in the value path consuming it. A phantom tag erases at exactly the JSON and SQL boundaries where the currency was already missing.

The live symptom is `region-mock-au-listing.ts`, whose own header calls it "the known IDR-field wart": AU fixtures store **AUD cents** in `faceValueIdr`, typed `IdrMinorUnits`, and render correctly only because every call site remembers to pass `"AUD"`. `fromLegacyAmount(value, currency)` therefore takes the currency as a **required argument** — a one-argument converter would have relabelled every AU fixture as Rupiah with the type system's blessing.

- [ ] ⚠️ **The wire migration is NOT done.** `faceValueIdr` → a currency-carrying field touches every consumer in the workspace; `IdrMinorUnits` and every existing schema are untouched here on purpose. Coordination session gated it behind a Zod-contracts↔migrations drift test, then one pass with one owner: contract, migration, Go models and all consumers ending green on `pnpm verify`
- Raised independently by both implementing sessions. Worth doing **regardless of how Xendit answers**, and now load-bearing if the platform really is two-region

### YT-0506 · CONFIRM: does Xendit take IDR in rupiah or sen?
`doing` · P0 · economy · 1d · dep: —

**MIGRATION DONE, 2026-09-20 — one pass, green on `pnpm verify` (9/9, 1658 TS tests), lint 9/9, Go 71 tests 0 skips, prettier clean.**

- [x] `MINOR_UNIT.IDR` → exponent 2, `confirmed`, with the founder's reasoning as its recorded evidence. `money.ts`'s ceiling ×100 (Rp 10bn in sen); the Zod message now says sen
- [x] **`rupiah(45_000)` and `audCents(1_250)` replace bare literals at every call site.** ~90 IDR literals across 23 files had to move, and the AU fixtures store **AUD cents in `faceValueIdr`** — a blanket ×100 would have turned $12.50 into $1,250. Excluding them by hand would have worked once and taught the code nothing, so the currency and unit are now stated where the literal is written: a bulk edit cannot reach the wrong set because they are different functions, and the ×100 exists in one place rather than ninety
- [x] **`20260920000011_idr_sen.sql`** — catalogue and IDR-scoped ledger rows ×100. `price_in_points` untouched. The ledger UPDATEs are scoped `WHERE currency = 'IDR'` because those tables *have* a currency column; the catalogue tables do not, so the migration **checks** that no AU-merchant row exists and refuses rather than corrupting it. That guard is YT-0513's wire migration justifying itself in SQL
- [x] **The 2 recorded daily Merkle proofs were deleted by the migration, deliberately.** Rewriting `amount_minor` invalidates every root over it, and `proof.VerifyDay` would have correctly reported `ALTERED` — paging a human about a change we made on purpose. A checker that cries wolf once gets muted. In production this is a signed re-baselining with the old roots archived, not a DELETE
- [x] **The backing rate was copied into four files at `= 6`.** Both sides of `points_price = S / B` had to move together or every price would be 100× wrong with nothing failing — each copy is only ever compared against values that agree with it. Now one zero-dependency module at 600 sen/point. Point prices are unchanged, which is the proof it worked
- [x] **Found en route: `public-jsonld.ts` published 100× the real price in structured data.** It branched on `currency === "AUD"` and divided by a literal 100, leaving IDR undivided — correct only while IDR was one-Rupiah. It now scales by `MINOR_UNIT`, so the knowledge lives in one place. This is the one surface where a wrong number is machine-readable and indexed by Google
- [x] `campaign-reward-risk.ts`'s `MOCK_DATA_COST_IDR_PER_MB` 4 → 400. The *ratio* was unaffected, but it exposes `dataCostMinorUnits` and `rewardValueMinorUnits` which the builder renders as money — a correct ratio beside two understated figures is the harder bug to spot
- [ ] ⚠️ **Still open, and always was a second question: what Xendit's API accepts.** This settles what we STORE. Adyen flags IDR as diverging from ISO precisely because processors differ, so the conversion belongs in each PSP adapter — which YT-0537 encodes by making the unit a declared property of the driver, checked by a parity test

- [x] ✅ **FOUNDER DECISION 2026-09-20: IDR has a sen minor unit and we store it. Exponent 2.** Rationale given: sen is uncommon in daily use but **banking uses it** — amounts appear as `Rp 1.000,26`. This matches ISO 4217, matches Stripe's treatment, and restores the original intent of `docs/12`, `docs/18` and YT-0041. The `money.test.ts` guard that pins Rupiah is now **expected to be inverted**, not preserved
- [x] ⚠️ **This settles the currency, not the processor — they were always two questions.** What Xendit's API accepts is still unconfirmed, and Adyen flags IDR as diverging from ISO precisely because processors differ. **The conversion belongs in the PSP adapter, not in a global constant** — which is what this ticket predicted it would come to, and what YT-0537 already encodes by making the unit a declared property of the payment driver
- [x] ⚠️ **The migration is a 100× change to every stored and fixture IDR value, and 100× is the error class this ticket exists to prevent.** It must run as **one unit of work with one owner** — contract, migration, Go models, mocks and every consumer in the same pass — and **behind the contracts↔migrations drift test**, not in front of it. Landing it piecemeal is how a value ends up converted twice or not at all, and both look identical afterwards

- [x] **Reconciled entry against the working tree, 2026-09-19.** This task previously claimed, ticked, that _"sen is now implemented across `money.ts`, `formatIdr`, `rupiahToSen()`, every mock and every Phase U fixture"_. **None of that is on disk.** `rupiahToSen` does not exist anywhere in the repo, `money.ts` still reads _"The IDR minor unit is currently 1 Rupiah"_, `money-format.ts` divides only the AUD branch by 100, and `money.test.ts` carries a **passing** guard named _"stores IDR as Rupiah, not sen, until YT-0506 settles"_. The tree implements **rupiah, deliberately and test-enforced**. The tracker was ahead of the code — whether by a revert or by a claim that never landed cannot now be told apart, and that ambiguity is itself the finding
- [x] **Two sen-flavoured artifacts left stranded on rupiah-valued data have been corrected**, because each told a developer the opposite of the truth at exactly the moment they would be debugging a unit problem: `money.ts`'s Zod message said _"must be a whole number of sen"_, and `listing.mock.ts` carried _"faceValueIdr is already sen … do NOT toIdrMinorUnits it"_ **directly above a line that calls `toIdrMinorUnits`**. Correcting a comment to match the code is not a decision on this ticket and does not pre-empt one
- [x] `money.ts` states the **evidence state** rather than a settled vendor fact: ISO 4217 says sen; **Stripe evidenced** (absent from its zero-decimal list); **Xendit UNCONFIRMED** — no published amount-unit spec, API reference silent, and a QR minimum quoted as "1 IDR" pointing the other way. Xendit is the processor that matters here
- [ ] ⚠️ **Confirm against the Xendit contract or sandbox.** This is the only open question
- [ ] ⚠️ **Founder to confirm which decision stands.** The recorded decision was _hold_; what is on disk is _adopt sen_. Neither session can distinguish a later instruction from a decision that did not arrive in time, and neither will revert or bless it unilaterally
- [ ] If Xendit takes rupiah, the rule shape is wrong: conversion belongs in each **PSP adapter**, not one global constant. Adyen flags IDR as diverging from ISO, so processors genuinely differ
- [ ] ⭐ **Adopt a currency-tagged Money type — `(int64 amount_minor, currency)` per `docs/12` §3 (Fowler).** The type currently carries **no currency tag at all**. AUD is unambiguously two-decimal, so tagging would let **AUD proceed while IDR stays blocked**, and turns "IDR is stored in X" into a per-processor conversion rather than a global rule — which is the shape this whole question keeps pointing at. Worth doing regardless of how Xendit answers

**The repo currently contradicts itself and both readings cannot ship.**

| Says rupiah                                                                                                                                                      | Says sen                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/contracts/src/money/money.ts` — _"the minor unit is defined here to equal exactly 1 Rupiah … **do not introduce a cents-of-Rupiah concept anywhere**"_ | `docs/12` §Minor units and decision #3; `docs/18`; YT-0041's AC |

**Why this outranks the int32 bug.** int32 truncation surfaces the first time a large value appears. A unit mismatch is **silent and uniform**: every amount is wrong by exactly 100×, every test passes because both sides agree internally, and it surfaces as a merchant settled **Rp450 instead of Rp45,000**. YT-0041's own AC calls it "a 100× error" without knowing the contracts package already went the other way.

**What the evidence says (researched 2026-09-19, inconclusive — which is itself the finding):**

- **ISO 4217 gives IDR a 0.01 minor unit (sen)** — technically two-decimal
- **Stripe does not list IDR as zero-decimal**, so Stripe amounts are in sen. Stripe is our **Australian** processor
- **Adyen explicitly flags IDR** as a currency where its table differs from ISO — so this is **processor-dependent, not universal**
- **Xendit — our actual Indonesian processor — does not document it publicly.** A QR minimum quoted as "1 IDR" hints at rupiah units but settles nothing

**Recommendation: sen**, on the reasoning in `docs/12` — an external constraint we do not control beats an internal convenience. **But confirm with Xendit first**, because the two processors in our stack may genuinely differ, and that possibility is the real lesson here.

### YT-0042 · Ledger transfer API
`review` · P0 · value · 5d · dep: YT-0041, YT-0039

- [x] `transfer()` writes ≥2 balanced entries in one transaction
- [x] Replay of an idempotency key returns the original transfer, never a second one
- [x] Concurrent transfers on one account are serialised and correct under load test
- [x] Built in Go to the agreed boundary — **moves integers, never interprets them.** Nothing converts, formats, prices or settles, so nothing here waits on YT-0506
- [x] `INSERT … ON CONFLICT (idempotency_key) DO NOTHING RETURNING`; no row back means someone owns the key and the existing transfer is read. A SELECT-then-INSERT leaves the window where two retries both find nothing and both write
- [x] Serializable with bounded retry on 40001: **16 concurrent transfers land at exactly 16×100; 8 concurrent retries of one key move value once**
- **`Balance` is a projection over entries, never a stored column.** A stored balance is a second source of truth, and when the two disagree the entries are right and the balance is the bug
- Queries are **sqlc-generated** against a `db/schema.sql` copy, with a drift test asserting the copy still matches the live database — silent drift there would have sqlc generating confidently wrong types against a schema that no longer exists
- **Defect found by YT-0043 and fixed: the concurrency test was passing for the wrong reason.** The earlier green was masked by a duplicate-key bug — every goroutine sent the same idempotency key, so fifteen of sixteen were cheap replays and there was almost no contention. With genuinely unique keys they all write, and five attempts exhausted on persistent 40001s. Now exponential backoff **with jitter**, ten attempts
- **Third defect, found by YT-0045:** the retry was not exported, so the Reward Engine opened its own Serializable transaction **with no retry** — 11 of 12 callers hit 40001 and gave up, which to a caller is indistinguishable from *"the allocation is exhausted"*. **Those need different answers: one means stop, the other means try again.** Fixed by exporting `ledger.WithSerializableRetry` rather than writing a second copy — a duplicated backoff policy is a second place to get the jitter subtly wrong, and this retry's behaviour has now mattered three times

- ⚠️ **Title and criteria disagree about scope, and the title is the one people read.** This ticket is called *"Ledger transfer API"*, and **not one of its criteria mentions a route** — every bar describes the Go function. The work is defensibly complete as written and the criteria are unusually rigorous; what overpromises is the word in the title. Raised by `yourtal-b6` while tracing why YT-0133 was unbuildable, escalated by `yourtal-a4`, and confirmed here against the source
- ℹ️ **The missing HTTP surface is now ticketed as **YT-0593****, so it is work in the graph rather than an implication nobody owns. **YT-0042 is not failed for this** — a ticket is measured against its criteria, not its title, and re-scoping it retrospectively would move the bar under work that already met it
- ⛔ **It should not reach `done` while the title still claims an API that does not exist.** `done` is the board's strongest public statement and this one would be read as *"the API is finished and verified"*. The fix is one of: retitle to what the criteria actually cover, or add a criterion for the route and return this to `doing`. **That is the epic owner's call, not the verifier's** — flagged here rather than decided. This is the third instance in one day of *proved in tests, absent from the running system*, after YT-0519 and the ledger having no HTTP caller

### YT-0043 · Chart of accounts
`doing` · P0 · value · 2d · dep: YT-0041

- [x] Account taxonomy defined: user, merchant, platform, escrow, charity, suspense, reserve
- [x] Points liability, breakage revenue and marketing-funded issuance mapped to real accounts
- [x] Reviewed by whoever owns finance
- [x] Five account kinds, seven owner types (adding the `suspense` and `reserve` YT-0518 never created), currency constrained to **YTP/IDR/AUD**. Points as a first-class ledger currency is what gives "a transfer may not mix currencies" teeth — a points entry and a Rupiah entry cannot accidentally sum
- [x] **Posting rules as code, not prose**: `EarnPoints`, `BurnPoints`, `ExpirePoints`, `IssueMarketingPoints`, `ToSuspense`. A pattern written in prose is one every caller re-derives, and re-derivation is where a sign flips
- [x] Points liability classified as a **liability** — points are a claim the user holds on us, and classifying them otherwise is how a growing obligation reads as a growing asset. **Funded issuance posts to a different contra account from marketing issuance**, because sharing one would make marketing spend indistinguishable from advertiser-funded issuance in every report that matters
- [ ] Finance review — **cannot be ticked: nobody owns finance yet** (YT-0050 still `todo`)
- Held to the classification/valuation line: no backing rate, no coverage ratio, no currency-per-point arithmetic anywhere

### YT-0044 · Invariant checker and daily proof
`doing` · P0 · value · 3d · dep: YT-0042

- [x] Continuous job proves every transfer balances — **every 15 minutes in `cmd/ledger`, not nightly**, because a nightly checker leaves a whole day in which the ledger is wrong and nobody knows
- [x] **"Every cached balance matches entries" is satisfied structurally: there are no cached balances.** `Balance` is a projection over entries, so the invariant is unfalsifiable because the thing it guards against was designed out. Recorded rather than quietly ticked, because a criterion that is true by absence and one that is true by checking are not the same claim
- [x] Daily Merkle root stored immutably in `ledger.daily_proof` — **verified against the live database by the coordinating session**: primary key on `proof_date` so a day can only be proved once, and `yourtal_ledger` holds **INSERT and SELECT only**, no UPDATE, no DELETE. Recomputation is the thing being denied: an attacker who can edit an entry *and* recompute its day's root has defeated the whole scheme
- [x] **Odd Merkle levels promote, never duplicate** (`TestOddLevelsPromoteRatherThanDuplicate`). Duplicating the last node is the usual shortcut and is CVE-2012-2459's shape — two different leaf sets yielding one root
- [x] **The canonical leaf separator is 0x1F, not a comma.** Account ids are caller-supplied strings, so with a printable separator an account named `a<SEP>b` could forge another ledger's canonical form — a collision the attacker chooses rather than waits for
- [x] Any imbalance pages a human; it does not merely log. `Alerter` is a **required constructor argument**, so a log-only checker cannot be built — the version that can only log is the version that ships. The placeholder is named `LoggingAlerter` for what it is
- [x] **The tamper test uses a superuser connection**, because the ledger role deliberately cannot alter an entry — the tamper has to outrank the control being tested, or the test proves the grant rather than the proof
- [x] ⚠️ **Two tests initially skipped and were fixed rather than accepted** — the tamper test and the prove-once test, the two that matter most, in the suite whose entire point is that a silent skip proves nothing. Each now takes an exclusive historical day and cleans up after itself. **The fix is cleanup, not a skip.** 11 tests, zero skips, repeatable
- [ ] ⚠️ **Held back from `review` on 2026-09-20 by YT-0567.** This ticket's proof is its test suite, and part of that suite is **non-deterministic across package boundaries**: `TestInvariantCheckerFindsNoImbalance` scans the whole ledger while `internal/proof` deliberately unbalances it, and the two packages share one Postgres under a concurrent `go test`. The isolation this ticket claims — _"an exclusive historical day and cleans up after itself"_ — holds **within** the proof package and not **between** packages
- [ ] ⚠️ The production checker is not implicated; the evidence for it is. **A ticket whose entire claim is "the proof runs and cannot silently skip" cannot be verified by a suite that fails depending on scheduling.** Re-offer for review once YT-0567 lands

### YT-0045 · Reward Engine skeleton
`doing` · P0 · value · 5d · dep: YT-0042

- [x] Sole path from a verified action to a points credit; nothing else may credit
- [x] Versioned action taxonomy with per-action value, caps and evidence requirements
- [x] Velocity caps per user, device, IP and day, enforced before the ledger call
- [x] **K6's structural half enforced and proved.** Drawdown is one statement — `UPDATE … WHERE remaining_points >= $2 RETURNING` — so an exhausted allocation matches **no row** and nothing is issued. *Cannot issue an unfunded point* is a property of the statement, not of the caller checking first; a read-then-write lets two concurrent grants both see enough and both draw, which is exactly how unfunded points get minted. `allocation_not_overdrawn` backs it as a CHECK
- [x] **Proved concurrently:** 12 callers race an allocation holding 4 completions' worth. Exactly 4 succeed, remaining lands at 0, balance is exactly 4×2400. Not one unfunded point
- [x] **Velocity counted from the grant log, not a counter.** A cap enforced against something lossy is not a cap — a dropped metric or evicted cache key becomes free points, and the attacker who notices first is the one it was meant to stop. Device and IP caps span all actions, since a per-action cap is defeated by doing several different actions from one farm
- [x] **`RiskGate` returns a decision, never a multiplier** — `docs/18` §9's "smarter in inputs, never in arithmetic" made structural. A gate that could scale a reward would be arithmetic, and two users completing the same campaign would quietly be paid differently; there is a test asserting they are not. The placeholder is named `AlwaysAllow` so it cannot be mistaken for a real control in a stack trace
- [x] Check order is the design: everything that can refuse runs **before** the ledger is touched, and drawdown + post + log share one transaction. An allocation decremented for points never issued destroys funding nobody can account for
- [ ] ⚠️ **Point values are placeholders at taxonomy v1** — needs the economy owner (YT-0050, still `todo`)
- [ ] ⚠️ `AlwaysAllow` stands in for YT-0054's real risk gate
- Scope held: no coverage ratio, no reserve formula, no `B`, nothing converting points to currency

### YT-0046 · Partner funding: point pre-purchase and drawdown
`review` · P0 · value · 5d · dep: YT-0042

- [x] A business buys a point block at `P_issue`; cash recorded into the segregated reserve
- [x] Campaigns draw down against an allocation and hard-stop at zero
- [x] An unfunded issuance attempt is rejected, not queued
- [x] **Nothing multiplies, divides or converts.** No stored price-per-point column — **verified: zero rate columns in the `ledger` schema.** A quotient is a third fact that can disagree with the two it came from, and when it does the two are right and the quotient is the bug
- [x] **The constraint forced the shape.** The two sides are in different currencies and a transfer may not mix currencies, so a purchase writes an allocation (points), a cash transfer into the segregated reserve (IDR or AUD), and a `point_purchase` row joining them. The audit trail exists because the trigger refused the alternative, not because someone chose well
- [x] Reserve is an **asset**, partner funding a **liability** — money received for points not yet issued is owed, not earned, and booking it as revenue on arrival is how a deferred obligation becomes a profit that was never made. Reserves are **per-currency**, verified, because one account holding two is a balance that is a number with no unit
- [x] Hard-stop proved end to end: a purchase funding exactly two completions pays two and refuses the third with `ErrAllocationExhausted`
- [x] Atomicity tested from the awkward direction — a repeated purchase id creates neither a second allocation nor a second reserve posting. **Cash received against nothing is the same defect as points without cash, pointing the other way, and much harder to notice**
- [x] Two purchases at genuinely different rates are recorded and asserted to differ — a test that fails if someone later "simplifies" the pairs into a rate column. Had a single rate been stored, one of the two would now be wrong and **which one would be unknowable**

### YT-0047 · Solvency monitor and coverage dashboard
`todo` · P0 · value · 4d · dep: YT-0046

- [ ] `Reserve / (points_outstanding × B)` computed continuously
- [ ] Alerts at 1.2; issuance blocked below 1.0
- [ ] Every unfunded grant path requires a matching cash transfer or it fails

## Economy

### YT-0048 · Monetary policy, written down
`doing` · P0 · economy · 3d · dep: YT-0012

- ✏️ **Unblocked 2026-09-21 by YT-0012 being signed. Written up as [`docs/25-monetary-policy.md`](../25-monetary-policy.md)** — a decision record, deliberately separate from `docs/09` §6, which is the design. Design explains why faucets need sinks and ranks the levers; this commits to what the parameters are, what happens when they change, and the bound they must never cross
- [ ] Opening `P_issue`, `B`, expiry policy, faucet rates and sink list agreed and recorded — **sink list and faucet list are in `docs/09` §6 and adopted unchanged; three scalars are blank and stay blank.** `P_issue`, `B` (ID) and `B` (AU) are the economy owner's to set. **Deliberately not placeholdered**: `B` is the 20% settlement-materiality failure with far more reach — it does not guard one control, it prices the entire catalogue via `points_price = (S / B) × demand_multiplier`, so a placeholder propagates into every price the moment anything reads it rather than sitting inertly waiting to be replaced
- [x] Devaluation playbook written, including how a change is announced — `docs/25` §4. Six steps. **Defines a devaluation by its effect rather than its mechanism**: any change that raises the points price of an unchanged item, so a sustained demand-multiplier increase counts as well as a cut to `B` — it is the same event to a user either way. Requires levers 1–2 tried and recorded first, **two-person approval with no threshold** (the catalogue-wide analogue of YT-0576, and it cannot have a weaker bar than a single listing's `S`), announcement before rather than after, the 15-minute price lock honoured through the change, and a log table in the document itself
- [ ] Checked against position ID-1 in `docs/24-legal-positions.md` — **checked, and it FAILS today.** `MOCK_BACKING_RATE_IDR_SEN_PER_POINT` and `MOCK_BACKING_RATE_AUD_CENTS_PER_POINT` reach the browser: `campaign-editor-reward.tsx:1` is `"use client"`, `:10` imports `./campaign-reward-risk`, which imports both rates at `:33-35` and uses them at `:73-74`, with no `server-only` on the path. The check was performed; the criterion is not met, and ticking it would claim a compliance the code contradicts
- ⛔ **YT-0589's `apps/web` half is a precondition of this ticket, not a follow-up.** Today the leak is harmless because it is the *mock* rate. **The blanks are load-bearing in both directions**: they are why the breach is currently theoretical, and filling them is what makes it real — because the obvious maintenance action when `B` is decided is to update that very constant, and then the true rate reaches browsers **with nothing failing**, since every consumer agrees with it
- ℹ️ **Expiry is the one blank that is not a commercial judgement.** It is bounded on both sides by law: too short reads as a gift-card expiry under Australian consumer guarantees (**AU-4**), and too long — or absent — removes one of the four features **ID-1** rests on. It must be set with `docs/24` open

### YT-0049 · Pricing engine
`todo` · P0 · economy · 5d · dep: YT-0048

- [ ] `points_price = (S / B) × demand_multiplier`; multiplier fixed at 1.0 for launch
- [ ] Price locked for 15 minutes once shown; never changes between cart and confirm
- [ ] Every price change is audit-logged per SKU

### YT-0050 · Name the economy owner
`doing` · P0 · economy · 2d · dep: —

- ✅ **Founder decision 2026-09-21: the founder holds the economy himself.** Accountable for issuance vs redemption, coverage, point values (**YT-0045**), the chart-of-accounts finance review (**YT-0043**), the settlement materiality rule (**YT-0576**) and `goodwillCreditCeilingIdr` (**YT-0582**). Delegating it later is a change of holder, not a re-opening of this ticket. **Recorded first-hand**: the founder answered it in this session directly. `yourtal-b6` reports the same answer from its own session, but per `yourtal-08` that is a **second relay rather than independent corroboration** — two sessions each reporting "the founder confirmed" is how one answer becomes three records
- [x] A named analyst or economist is accountable for issuance vs redemption and coverage
- [x] Daily review checklist agreed — **it already existed and nobody had adopted it.** `docs/09` §6 specifies what the economy owner looks at each morning: issuance rate vs redemption rate · points outstanding and its growth · coverage ratio · average realised value per point · days-to-first-redemption · catalogue depth by price band · share of outstanding points held by the top 1% of holders. Adopted **unchanged** as the agreed checklist in [`docs/25-monetary-policy.md`](../25-monetary-policy.md) §6, on the founder's standing instruction to proceed. Found while drafting YT-0048, not by looking for it
- ⚠️ **The checklist is agreed and is not yet a control anyone can perform.** None of the seven measures is instrumented: the coverage ratio is measured from ledger projections rather than a stored total (**YT-0130**), and the rest needs the event schema (**YT-0059**) and the economy dashboard (**YT-0307**). So this criterion is honestly met — it asked for agreement, not instrumentation — but **the checklist is currently a specification of what to build, and must not be recorded anywhere as a working control**

## Risk

### YT-0051 · Device signal interface, web implementation
`todo` · P0 · risk · 4d · dep: YT-0030

- [ ] One interface; web implementation now, native implementation later (Capacitor escape hatch)
- [ ] Fingerprint, headless/automation detection and IP/ASN reputation collected at registration

### YT-0052 · Turnstile and rate limiting
`todo` · P0 · risk · 3d · dep: YT-0516

- Re-parented onto the local stack (YT-0516): this needed _a_ service, not a _managed_ one. The cloud task now covers deployment only.
- [ ] Turnstile on registration, login and any reward claim
- [ ] Per-route, per-identity and per-IP limits with a shared Redis backend

### YT-0053 · WebAuthn passkey enrolment
`todo` · P0 · risk · 4d · dep: YT-0033

- [ ] Passkey enrolment offered after first reward, incentivised with points
- [ ] Passkey presence raises the account's trust tier

### YT-0054 · Risk score service and trust tiers
`todo` · P0 · risk · 5d · dep: YT-0051, YT-0052

- [ ] Tiers 0–3 with distinct earn rates, velocity caps and holdback lengths
- [ ] Reward Engine consults the score before every credit
- [ ] Manual review queue exists with an owner and an SLA

## Web

### YT-0055 · Next.js app shell and design tokens
`doing` · P0 · web · 5d · dep: YT-0030

- **Audited 2026-09-19: Phase U built this and Phase 0 never recorded it.** Two phases describing one deliverable is how a finished thing keeps blocking unfinished ones — this was gating three tasks while `packages/ui` already shipped what it asks for
- [x] Colour, spacing and type tokens defined once in `packages/ui` — `src/styles/tokens.css`, with `contrast.test.ts` asserting the palette rather than trusting it
- [x] Dark mode, via `src/styles/theme.css`
- [ ] ⚠️ **"No client component above the fold" is not true today** and was never measured — `app/(app)/business/reports/page.tsx` and `app/(app)/campaign/[campaignId]/page.tsx` are `"use client"` at page level. Either the criterion is wrong or the pages are; decide which rather than ticking it
- [ ] RTL-safe layout primitives — unverified. Neither shipped locale is RTL, so this has never been exercised

### YT-0056 · UI primitives package
`doing` · P0 · web · 5d · dep: YT-0055

- [x] **Audited: already built.** button/input/select/sheet/dialog/toast/skeleton, Radix where interaction demands it, largest non-test file 127 lines. Minor polish left: badge/card/skeleton have no dedicated a11y tests, which is defensible while they stay non-interactive — `skeleton` is correctly `aria-hidden`
- [ ] Button, input, select, sheet, dialog, toast, skeleton built on Radix
- [ ] Every primitive keyboard-accessible and screen-reader tested
- [ ] No file in the package exceeds 300 lines

### YT-0057 · CWV budgets in CI and RUM in production
`todo` · P0 · web · 4d · dep: YT-0028, YT-0055

- [ ] Lighthouse CI fails a PR breaching LCP 2.0s / TBT 200ms / CLS 0.1 / JS 200KB, with 180–200KB passing but flagged for written justification
- [ ] Throttled to mid-tier Android over 4G, not desktop defaults
- [ ] RUM reports p75 segmented by country, connection and device class

### YT-0058 · Internationalisation scaffolding
`doing` · P0 · web · 3d · dep: YT-0055

- [x] **Two real gaps found and closed.** The five nav labels were hardcoded English rendered in both nav components — **the one screen every user sees, unlocalised**. Now resolved through a translator like every other surface
- [x] **AC3 (a missing translation fails the build) did not exist anywhere.** Now `messages-parity.test.ts` walks every locale pair and asserts identical key sets recursively — and it was **sabotage-tested**: a key deleted, the failure named that exact key, key restored, green
- [ ] ⚠️ **Same gap found elsewhere and left alone:** `checkpoint-progress.tsx` carries a hardcoded Indonesian string with no locale switch. Different feature, same class
- [ ] `id-ID` and `en-AU` locales; no hard-coded user-facing string anywhere
- [ ] Currency, date and number formatting per locale
- [ ] Missing-translation check fails the build

## Data

### YT-0059 · Event schema and ingestion skeleton
`todo` · P0 · data · 4d · dep: YT-0040

- [ ] Versioned event schemas in the contracts package
- [ ] Batched client ingestion; events land in Postgres with a path to ClickHouse later
- [ ] No PII in analytics events without a consent check

### YT-0567 · The clean-ledger invariant test races the proof test's tamper window
`todo` · P0 · value · 2d · dep: YT-0044

- **Found 2026-09-20 by running Go under the repo gate for the first time.** `TestInvariantCheckerFindsNoImbalance` (`internal/ledger/transfer_test.go`) failed with `found 1 imbalanced transfers: [{led_txn_proof_… 3}]`. The `3` is not a coincidence: `internal/proof/proof_test.go:280` does `UPDATE ledger.entry SET amount_minor = amount_minor + 3` to prove a tamper is detected, and restores it in a `defer`
- **The two packages share one Postgres and `go test` runs package binaries concurrently.** While proof's tamper window is open, the ledger package asserts the whole ledger balances. It does not
- ⚠️ **The test cannot tell a real bypassed trigger from a sibling test's deliberate tamper**, which is exactly what its own comment claims it is for: _"the day it does not [pass], the trigger has been dropped or bypassed and nothing else would say so."_ That sentence is now false
- ⚠️ **The obvious fix is the wrong one.** Scoping the query to the test's own transfers makes it pass and **destroys the property it exists for** — catching an imbalance *anywhere*, including one nobody predicted. The tenth gate this month to be weaker than its name; the first where the repair is the trap
- ⚠️ The author knew about this coupling: `proof_test.go:149` reads _"Tamper, keeping the transfer BALANCED so the other invariant stays"_. That care was taken at line 153 and **not** at 242 (`+7`) or 280 (`+3`)
- [ ] Decide the mechanism. **Recommended by `yourtal-22` 2026-09-20, and it is better than serialising: a database per test package.** Serialising with `-p 1` hides the disagreement rather than resolving it — the two packages genuinely disagree about whether `ledger.entry` may be unbalanced mid-test, and both are right within their own scope. Giving each its own database lets `-p 1` come **off**, and it is cheap now because `infra/postgres/init/01-schemas.sql` is already idempotent and re-runnable against a fresh database. It is the same trick `yourtal-22` is using to run three agents against one cluster. **Whatever is chosen must keep the global scan global**
- [ ] The two unbalanced tamper windows (`+7` at 242, `+3` at 280) stop being unbalanced, or stop being visible to other packages
- [ ] **The restores are `_, _ = super.Exec(...)` — errors discarded.** A failed restore, a `SIGINT` or a panic leaves permanent imbalance in the shared dev database and nobody is told. Assert the restore, or make cleanup not required for correctness
- [ ] Sabotage-prove it: hold a tamper window open deliberately and confirm the chosen mechanism reports the *right* answer rather than merely a green one
- [ ] Remove `-p 1` from `services/*/package.json` once the fix lands, and confirm the suite is still deterministic without it

### YT-0593 · The ledger's four v1 routes are all 501
`todo` · P0 · value · 3d · dep: YT-0042, YT-0036, YT-0515

- ℹ️ **Filed 2026-09-21 by `yourtal-22`, from a finding by `yourtal-b6` relayed via `yourtal-a4`, re-verified here against the source rather than accepted.** `services/ledger/internal/api/routes.go` — its own comment at `:63` says **"None of the four is live."** `/accounts/{accountID}/balance` (`:80`), `/pricing/quote` (`:86`), `/transfers` (`:97`) and `/rewards/grants` (`:102`) are each `a.notYetExposed(...)`, returning `http.StatusNotImplemented`
- ✅ **The 501s are honest engineering, not neglect, and each names its own blocker.** `/transfers` is waiting on caller authentication and the shared idempotency interceptor, which `docs/13a` section 7 requires **in front of** a money-moving handler — serving it unauthenticated would let any caller move balances between arbitrary accounts. This ticket is to satisfy those blockers, not to remove the guard
- ⚠️ **The gap this closes is a reporting one as much as a functional one.** YT-0042 is titled *"Ledger transfer API"* and sits at `review` with 6/6, yet every one of its criteria describes `transfer()` the Go function and **not one mentions a route**. Defensibly complete as written, misleading as titled. This is the third instance in one day of *proved in tests, absent from the running system*, after YT-0519 and the ledger having no HTTP caller at all
- [ ] `POST /v1/transfers` is reachable and moves balances, behind caller authentication and the shared idempotency store
- [ ] A replay of the same request returns the original transfer rather than moving money twice — the property YT-0042 proves at the function boundary, re-proved at the HTTP boundary, because the interceptor is what YT-0042 did not cover
- [ ] The other three routes are either exposed under the same conditions or their 501 is reaffirmed with a stated reason, so the count of unexposed routes is a decision rather than a leftover
- [ ] **`B` is not returned to any caller, authenticated or not** — `/pricing/quote`'s existing refusal is preserved, per YT-0130's GRANT-level control and `docs/24` ID-1

