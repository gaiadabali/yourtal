# Audit: engine-money (services/ledger + money contracts)

Audited 2026-09-25 against HEAD `b225116` on branch `tasks-audit-2026-09-21`. I did not edit anything in the repo. I trusted the code over the docs and the board.

## Verdict

The **arithmetic core is sound**. The double-entry trigger works, idempotent replay works, the Serializable retry works, the pricing formula and its rounding are right, and the Merkle construction is right. The **money system around that core does not exist yet**:

- Nothing in the product calls the reward engine, the purchase recorder, the solvency check, burn, expiry or the daily proof. All four HTTP routes return 501.
- The store lets the merchant type in the points price, which is the exact failure docs/09 §4 was written to prevent.
- Unfunded (marketing) points are issued with no reserve transfer, which breaks K6. One test locks that behaviour in.
- The reward amount is a hardcoded global (2,400 points per watch), worth about AUD 72 at the decided AU backing rate.
- There is no holdback, no reversal, no overdraft protection, no hash chain, no price lock, no clearing or settlement, and no enforced solvency threshold.

Treat the engines as a well-tested library of parts that has not been built into a system.

## Test results

`go test -count=1 ./...` in `services/ledger`: **77 top-level tests passed, 0 failed, 0 skipped.** The local Postgres at `127.0.0.1:26432` was reachable, so the DB-backed tests really ran.

**Disclosure:** this means the run wrote test rows to the shared dev database. Those rows are accounts, transfers, entries and grants with unique ids, plus append-only `ledger.backing_rate` AUD fixture rows at 0.6 cents per point. The proof tests clean up their far-past days.

I also ran pure audit tests through `go test -overlay`. The files live in the scratchpad, and `git status` confirmed nothing in the repo changed. Results:

- `PriceInPoints(30000, B=6, 0.8x)` gives **4,000 points**. At P_issue = 7 that collects **28,000 against a 30,000 settlement, a loss of 2,000**. The DB allows this pair of rates.
- The taxonomy's 2,400-point watch reward is worth **7,200 AUD cents (AUD 72)** at B = 3 cents, and IDR 14,400 at B = IDR 6.
- `validate()` accepts entries `{MaxInt64, MaxInt64, 2}`, whose true sum is 2^64. Their int64 sum wraps round to zero.
- `validate(BurnPoints(u, 1,000,000))` passes for a user with no balance. There is no overdraft check anywhere.
- Merkle `Root` changes when one account is swapped for another in a balanced transfer, so it does catch balanced tampering.

`apps/api` `tsc --noEmit` is **red in the store module**, with about 20 errors. Examples: `drizzle-listing.repository.ts:99`, `listing-assembler.ts:44`, `apply-settlement-value-change.ts:56`. The YT-0513 rename to `*Minor` plus `currency` is only half landed.

## Engine by engine

### 1. Ledger (`internal/ledger`): partial, and the core works

**Works:**

- A deferred constraint trigger checks at least 2 entries, a sum of zero and a single currency (`migrations/20260919000002_ledger.sql:62-96`).
- Replay is idempotent through `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` (`db/query/ledger.sql:1-7`; `transfer.go:163-178`).
- Transfers run at Serializable with jittered retry (`transfer.go:263-285`).
- Updates and deletes are revoked (`…002_ledger.sql:105`).
- Concurrency tests pass (`transfer_test.go:167-231`).

**Defects:**

- **No overdraft guard.** No constraint or check stops a user points account going negative. `transfer_test.go:120` even expects -1500. Two concurrent burns of 400 against a 500 balance both commit, because nothing reads the balance, so Serializable has nothing to conflict on.
- **Entry currency is not tied to account currency.** The trigger compares entries only with each other. `GetAccountBalance` and `SumAccountBalance` sum `amount_minor` regardless of currency (`ledger.sql:36-42`, `pricing.sql:45-50`). A YTP entry can therefore land on `plat_reserve_IDR` and inflate the reserve.
- **A replay with a different payload returns success** (`transfer.go:172-178`). If key K was used for 900 and is reused for 5,000, the caller gets `Replayed:true` and the 5,000 never moves. docs/13 requires "same key + different body rejects".
- **Transfers are never sealed.** Balanced entries can be appended to an already-committed transfer in a later transaction, and the trigger re-sums the whole set to zero.
- **The ledger role can backdate entries.** It holds table-level `INSERT` (`…002_ledger.sql:103`), so it can set `created_at` explicitly. `proof_test.go` claims the role cannot.
- **Missing from docs/18 §1 and docs/02 §6:**
  - hash-chained entries
  - `transfer.reference`, `status` and `metadata`
  - the cached balance plus nightly reconcile
  - the point-to-voucher saga with a compensating transfer
- `validate()` sums in int64 (`transfer.go:309-328`), so the overflow case above gets through. The DB still rejects it.
- **Not exposed.** `/v1/transfers` and `/v1/accounts/{id}/balance` both return 501 (`internal/api/routes.go:80-106`).

### 2. Chart of accounts (`chart.go`): partial, and the sign convention contradicts itself

- `chart.go:162` says "a POSITIVE amount increases the account's balance". The migration (`…002_ledger.sql:40`) says "debits negative, credits positive".
- `FundReserve` (`chart.go:260-264`) posts **-X to a liability and +X to an asset**. Under chart.go's convention that is assets up X and liabilities down X, which breaks A = L + E. Under the migration's convention the reserve went _down_.
- Example: after an AUD 10,000 purchase, a balance sheet grouped by `kind` shows +AUD 10,000 of assets and -AUD 10,000 of liabilities.
- **Accounts that do not exist:**
  - voucher liability or supplier payable
  - spread or margin revenue (P_issue minus B is never recognised)
  - marketing cash
  - escrow or suspended balances (docs/18 §5: "suspended and escrowed, never silently zeroed")
- **Not per country.** Platform account ids are fixed strings (`chart.go:80-88`, `:95`, `:152`). `EnsureChart("AU")` after `EnsureChart("ID")` does nothing, so AU contra legs post into an account tagged `ID`, which breaks B6.

### 3. Invariant checker and daily proof (`internal/proof`): runs, but the proof half is inert in production

- `cmd/ledger/main.go:118-119` runs `checker.Run` every 15 minutes (`:57`). It checks two things: imbalanced transfers, and yesterday's proof.
- **Nothing ever calls `RecordDailyProof` (`checker.go:65`).** So `VerifyDay` hits "never proved; nothing to verify" (`checker.go:104`) and passes every time.
- **Only yesterday is ever verified** (`checker.go:156`). An edit made two or more days back is never re-checked.
- **The root sits in the same Postgres a superuser can UPDATE.** docs/14 §8 requires a write-once bucket in a separate project, plus publication. The design assumes a superuser attacker and then stores the evidence where that attacker can rewrite it.
- The proof covers `ledger.entry` only. `allocation`, `grant`, `point_purchase` and `backing_rate` are not covered.
- The pager is `LoggingAlerter` (`alerter.go:26-29`), which returns nil, so nobody is ever paged.
- **The checker can be disabled by the tamper it should report.** `FindImbalancedTransfers` casts `SUM` to bigint (`ledger.sql:44-50`). A tampered transfer whose sum overflows bigint makes the query error, and `runChecker` only logs errors.
- The Merkle maths is correct: promotion instead of duplication, a 0x1F separator, and a leaf that includes the id.

### 4. Pricing (`price.go`, `engine.go`): the formula is right and unused; the lock and SKU audit are missing

**Works:**

- `PriceInPoints` computes ceil(S × 1e6 × bps / (B × 1e4)) in big.Int (`price.go:121-157`). It has a floor of 1 and bounds of 0.80 to 1.25 (`:55-57`).
- `SettlementLiabilityMinor` rounds up (`:169`).
- `SetRate` is append-only and effective-dated, with a reason (`engine.go:69-91`).

**Defects:**

- **The supplier sets the points price.** `createListingSchema.priceInPoints` is a body field (`apps/api/src/modules/store/dto/create-listing.schema.ts:32`), passed straight through at `store-listing.controller.ts:58`. Cerbos lets `business_inventory_editor_of` create listings (`policies/resource_policies/listing.yaml`, rule `merchandisers-run-inventory`).
  - Example: a merchant lists S = IDR 30,000 at 1,000 points, where the engine would price 5,000. At P_issue = 9 that collects IDR 9,000 against a 30,000 settlement, a **loss of IDR 21,000 per redemption**.
  - `Quote` has no production caller, and `/v1/pricing/quote` returns 501.
- **The margin guarantee fails below a 1.0 multiplier.** The CHECK only enforces `B < P_issue` (`…014_pricing.sql:62-64`). The 0.8 floor needs `B ≤ 0.8 × P_issue`; see the 2,000 loss above.
- `demand_multiplier_bps` is chosen by the caller (`routes.go:164`). docs/18 §10 wants it pinned at 1.0 for P1.
- `RecordPurchase` never checks the actual price paid against the P_issue on the rate row.
- A caller can backdate `at` to pick up an older, cheaper rate (`routes.go:222-231`).
- **Missing:**
  - the 10 to 15 minute price lock (docs/09 §4.2, docs/13 must-have test)
  - a per-listing stored multiplier
  - persisted quotes or a price audit per SKU. `listing_price_revision.new_price_in_points` is always null (`apply-settlement-value-change.ts:69`).
- **No real rates in the DB.** Only test fixtures exist: AUD at 0.6 cents against a decided 3 cents. No P_issue has been decided for AU, and the CHECK needs one before a valid AU rate row can exist.

### 5. Solvency (`solvency.go`): the arithmetic is right; nothing evaluates or enforces it

- **Works:** `Coverage` computes floor(reserve × 1e4 / ceil(points × B / 1e6)) (`solvency.go:75-126`). It keeps "nothing owed" as its own state rather than a ratio.
- **Never called outside tests.**
  - No K7 threshold at 1.1 exists; only `CoverageFloorBps` and `CoverageAlertBps` are defined (`:22-23`).
  - `Grant` never checks coverage, so the "block unfunded issuance at 1.0" rule does not exist.
  - docs/13's must-have test "unfunded issuance is blocked" is inverted. `TestAnUnfundedFaucetDrivesCoverageDown` (`solvency_test.go:26-112`) asserts that unfunded grants succeed.
- **The reserve formula is incomplete.** docs/09 §5 says: minus settlements paid, plus marketing cash. Neither is posted.
- **Burned points leave the denominator, but the voucher obligation (S) is not counted.** Example: reserve 900, 100 points outstanding at B = 6, ratio 1.5. The user burns all 100 on a voucher with S = 600. Coverage now reads "nothing owed" while IDR 600 is still owed.
- Any `(country, currency)` pair is accepted, so an AU reserve can mask an ID shortfall.
- Negative user balances reduce points outstanding, which flatters the ratio.

### 6. Reward Engine (`internal/reward`): partial and not wired in

**Works:**

- The atomic drawdown `UPDATE … WHERE remaining_points >= $2` (`ledger.sql:57-66`) and the post and grant log all share one Serializable transaction (`engine.go:218-278`).
- The concurrency test for overdrawing an allocation passes.

**Defects:**

- **Hardcoded magnitudes.** `taxonomy.go:89-106`: watch = 2,400 (AUD 72), quick = 60, checkpoint = 200, streak = 500, referral = 5,000, receipt = 300.
  - The founder rule says no hardcoded magnitude, and the reward must stay under AUD 5 per 20 minutes. 2,400 is **14 times that ceiling**, and 20 are allowed per day (AUD 1,440).
  - `campaign.reward_config` was granted to the ledger role (`20260922020000…sql:41-42`), but the engine, `db/schema.sql` and the sqlc queries never read it.
- **Velocity race.** `checkVelocity` reads through `e.pool` outside the transaction (`engine.go:157-199`). Example: a user at 19 of 20, with 5 concurrent grants on distinct refs, gets 24 grants, or 9,600 extra points.
- **The clock is caller-supplied.** `since` comes from `req.Now` (`:162`), and a future `Now` bypasses every cap.
- **Any caller can draw from any allocation.** `GrantRequest` has no campaign (`engine.go:65-82`), so one partner's allocation can fund another partner's viewers. `max_points_for_campaign` is not enforced.
- **Partner money can pay for platform marketing.** A `MarketingFunded` action drawing from a _partner_ allocation posts as marketing expense (`engine.go:290-295`). The streak test does exactly this (`engine_test.go:190-227` with `fundedAllocation` at `:64-70`).
- **Two users with the same `ExternalRef` collide.** The transfer and grant ids leave out the user (`engine.go:239`, `:255`), so the second user fails with a raw PK violation.
- **Missing:**
  - the risk gate is a placeholder (`AlwaysAllow`, `:62`), and trust tiers do not exist
  - holdback (B7: 72 h at tier 0, then 48, 24 and 0) and any pending state. The `Balance` contract already promises `pendingPoints` and `pendingUnlockAt` (`contracts/src/balance/balance.ts:13-16`).
  - reversal, clawback and escrow
- **No caller.** `watch.controller.ts:171-195` marks a session complete and grants nothing. `/v1/rewards/grants` returns 501.

### 7. Purchase and K6 (`purchase.go`, `setup.go`): partial, and K6 is broken

- **Works:** `RecordPurchase` writes the allocation, the reserve transfer and the pair row atomically (`purchase.go:79-145`).
- **K6 holes:**
  - `CreateAllocation` (`setup.go:46-62`) creates `partner` or `marketing` allocations with **no cash and no purchase**. There is no FK from allocation to purchase.
  - The ledger role holds **table-wide UPDATE on `ledger.allocation`** (`…007_reward_engine.sql:67`). As an example of what that allows: `SET total_points = 1e10, remaining_points = 1e10` passes every CHECK and funds 10 billion points behind one AUD 10,000 purchase.
  - `ledger.Transfer(EarnPoints)` issues points with no allocation at all. The "sole path" claim holds by convention only.
- `RecordPurchase` has no payment or PSP reference. A replay returns `ErrAlreadyGranted` instead of the original result (`purchase.go:105`).
- **No caller.**

### 8. Burn and expiry: posting rules only

- `BurnPoints` and `ExpirePoints` (`chart.go:186`, `:199`) have no callers.
- The voucher saga says "after debiting points" (`services/voucher/internal/issue/allocate.go:51`), but nothing debits anything.
- There is no `last_activity_at` (docs/25 §3), and no expiry job.

### 9. Money contracts (`packages/contracts/src/money`): currency-aware but half migrated

- `moneySchema` carries its currency (`money-value.ts:54-68`). But `create-listing.schema.ts` still uses `idrMinorUnitsSchema` and `*Idr` names.
- **Rounding differs from the policy.** `pointsPriceFromSettlement` uses `Math.round` (`money.ts:169`), while docs/25 says "always up". Example: AUD S = 1,000 cents at B = 3 cents gives 333 points, where Go gives 334. Every seeded listing price comes from this function.
- **The two ceilings disagree.** `MAX_SAFE_AMOUNT_MINOR = 1e10` (`money-value.ts:50`) against `1e12` (`money.ts:50`), even though a comment says they are shared. `money()` rejects IDR amounts above Rp 100 million in sen.
- **The IDR unit is contradicted.** The code says sen, exponent 2, "confirmed" (`minor-unit.ts:107-118`). The **uncommitted** working-tree `docs/25` §2 and §9 (another session's edit) say whole Rupiah, exponent 0, decided 2026-09-22.
- **The seed will not run.** `seed.ts:343` inserts into `face_value_idr`, which was renamed in `20260922030000`. That same migration wraps itself in `BEGIN`/`COMMIT` with no `txmode none`, which the repo's own idr_sen header says breaks Atlas; this needs verifying.

## Engines from docs/18 that are missing entirely here

1. **Clearing & Settlement (docs/18 §4):** no per-partner obligations, no netting, no statements, no payouts. Voucher capture never posts to the ledger.
2. **The Solvency Monitor as a running engine:** only a library function exists, with no job, dashboard or enforcement.
3. **Price lock (docs/18 §10)**, which is part of the Pricing Engine.
4. **Pacing Engine (docs/18 §13):** no per-campaign token bucket. Allocation drawdown is the only hard stop.
5. **Points expiry and lifecycle (docs/18 §14, docs/25 §3).**
6. **The hash chain (docs/18 §1).**

## Where the old board is wrong

- **YT-0046** is marked `done` with "[x] An unfunded issuance attempt is rejected". That is false for `CreateAllocation` and for marketing allocations. "Buys at P_issue" is not checked.
- **YT-0045** has "[x] nothing else may credit". That is false, because `ledger.Transfer` can issue points directly.
- **YT-0044** has "[x] Daily Merkle root stored immutably". It is never recorded in production.
