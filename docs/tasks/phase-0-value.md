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
`review` · P0 · value · 3d · dep: —

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

### YT-0043 · Chart of accounts
`review` · P0 · value · 2d · dep: YT-0041

- [x] Account taxonomy defined: user, merchant, platform, escrow, charity, suspense, reserve
- [x] Points liability, breakage revenue and marketing-funded issuance mapped to real accounts
- [x] Reviewed by whoever owns finance
- [x] Five account kinds, seven owner types (adding the `suspense` and `reserve` YT-0518 never created), currency constrained to **YTP/IDR/AUD**. Points as a first-class ledger currency is what gives "a transfer may not mix currencies" teeth — a points entry and a Rupiah entry cannot accidentally sum
- [x] **Posting rules as code, not prose**: `EarnPoints`, `BurnPoints`, `ExpirePoints`, `IssueMarketingPoints`, `ToSuspense`. A pattern written in prose is one every caller re-derives, and re-derivation is where a sign flips
- [x] Points liability classified as a **liability** — points are a claim the user holds on us, and classifying them otherwise is how a growing obligation reads as a growing asset. **Funded issuance posts to a different contra account from marketing issuance**, because sharing one would make marketing spend indistinguishable from advertiser-funded issuance in every report that matters
- [ ] Finance review — **cannot be ticked: nobody owns finance yet** (YT-0050 still `todo`)
- Held to the classification/valuation line: no backing rate, no coverage ratio, no currency-per-point arithmetic anywhere

### YT-0044 · Invariant checker and daily proof
`review` · P0 · value · 3d · dep: YT-0042

- [x] Continuous job proves every transfer balances — **every 15 minutes in `cmd/ledger`, not nightly**, because a nightly checker leaves a whole day in which the ledger is wrong and nobody knows
- [x] **"Every cached balance matches entries" is satisfied structurally: there are no cached balances.** `Balance` is a projection over entries, so the invariant is unfalsifiable because the thing it guards against was designed out. Recorded rather than quietly ticked, because a criterion that is true by absence and one that is true by checking are not the same claim
- [x] Daily Merkle root stored immutably in `ledger.daily_proof` — **verified against the live database by the coordinating session**: primary key on `proof_date` so a day can only be proved once, and `yourtal_ledger` holds **INSERT and SELECT only**, no UPDATE, no DELETE. Recomputation is the thing being denied: an attacker who can edit an entry *and* recompute its day's root has defeated the whole scheme
- [x] **Odd Merkle levels promote, never duplicate** (`TestOddLevelsPromoteRatherThanDuplicate`). Duplicating the last node is the usual shortcut and is CVE-2012-2459's shape — two different leaf sets yielding one root
- [x] **The canonical leaf separator is 0x1F, not a comma.** Account ids are caller-supplied strings, so with a printable separator an account named `a<SEP>b` could forge another ledger's canonical form — a collision the attacker chooses rather than waits for
- [x] Any imbalance pages a human; it does not merely log. `Alerter` is a **required constructor argument**, so a log-only checker cannot be built — the version that can only log is the version that ships. The placeholder is named `LoggingAlerter` for what it is
- [x] **The tamper test uses a superuser connection**, because the ledger role deliberately cannot alter an entry — the tamper has to outrank the control being tested, or the test proves the grant rather than the proof
- [x] ⚠️ **Two tests initially skipped and were fixed rather than accepted** — the tamper test and the prove-once test, the two that matter most, in the suite whose entire point is that a silent skip proves nothing. Each now takes an exclusive historical day and cleans up after itself. **The fix is cleanup, not a skip.** 11 tests, zero skips, repeatable

### YT-0045 · Reward Engine skeleton
`review` · P0 · value · 5d · dep: YT-0042

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
`todo` · P0 · economy · 3d · dep: YT-0012

- [ ] Opening `P_issue`, `B`, expiry policy, faucet rates and sink list agreed and recorded
- [ ] Devaluation playbook written, including how a change is announced
- [ ] Checked against position ID-1 in `docs/24-legal-positions.md`: no fixed consumer rate is ever published, and `B` never appears in a user-facing surface

### YT-0049 · Pricing engine
`todo` · P0 · economy · 5d · dep: YT-0048

- [ ] `points_price = (S / B) × demand_multiplier`; multiplier fixed at 1.0 for launch
- [ ] Price locked for 15 minutes once shown; never changes between cart and confirm
- [ ] Every price change is audit-logged per SKU

### YT-0050 · Name the economy owner
`todo` · P0 · economy · 2d · dep: —

- [ ] A named analyst or economist is accountable for issuance vs redemption and coverage
- [ ] Daily review checklist agreed

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
`todo` · P0 · web · 5d · dep: YT-0055

- [ ] Button, input, select, sheet, dialog, toast, skeleton built on Radix
- [ ] Every primitive keyboard-accessible and screen-reader tested
- [ ] No file in the package exceeds 300 lines

### YT-0057 · CWV budgets in CI and RUM in production
`todo` · P0 · web · 4d · dep: YT-0028, YT-0055

- [ ] Lighthouse CI fails a PR breaching LCP 2.0s / TBT 200ms / CLS 0.1 / JS 200KB, with 180–200KB passing but flagged for written justification
- [ ] Throttled to mid-tier Android over 4G, not desktop defaults
- [ ] RUM reports p75 segmented by country, connection and device class

### YT-0058 · Internationalisation scaffolding
`todo` · P0 · web · 3d · dep: YT-0055

- [ ] `id-ID` and `en-AU` locales; no hard-coded user-facing string anywhere
- [ ] Currency, date and number formatting per locale
- [ ] Missing-translation check fails the build

## Data

### YT-0059 · Event schema and ingestion skeleton
`todo` · P0 · data · 4d · dep: YT-0040

- [ ] Versioned event schemas in the contracts package
- [ ] Batched client ingestion; events land in Postgres with a path to ClickHouse later
- [ ] No PII in analytics events without a consent check
