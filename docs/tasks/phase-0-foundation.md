# Phase 0 · Legal, infrastructure, platform

Nothing user-visible ships except a login. **Gate:** a sister app can log a user in via YourtalID, call the Reward Engine, and have points appear as balanced ledger entries that survive a replay and a reconciliation run — with legal sign-off on the currency model in writing.

---

> Legal and infrastructure. Platform tasks are in [`phase-0-platform.md`](phase-0-platform.md).

## Legal

### YT-0010 · Legal positions register
`done` · P0 · legal · 4d · dep: —

- **Audited 2026-09-19: three of four criteria already met, still recorded as not started — while blocking four tasks.** `docs/24-legal-positions.md` exists with 19 positions
- [x] Every legal position the product relies on stated explicitly in `docs/24-legal-positions.md`
- [x] Each position traced to a primary or official source, with a confidence rating
- [x] Residual risk named per position; unsourced positions marked as guesses — ID-12 and AU-9 (minimum age) are carried openly as uncited
- [x] **Re-verification dates, now present on all 21 positions.** A legal register with no expiry quietly becomes a record of what was true once, and both regimes are mid-reform: Australia's Privacy Act is in passage, and Indonesia's GR 33/2026 sanctions bite 16 Jan 2027. **The dates are derived by a stated rule rather than chosen per position**, and the rule is written into `docs/24` so a later reader can recompute them and argue with the rule instead of trusting twenty-one judgements
- ✅ **Verified 2026-09-21 by `yourtal-22`; written by `yourtal-a4`, so author and verifier are different sessions.** Re-measured here rather than accepted on report — **21 position rows, 0 missing a `Re-verify by` value**, and every row populated across all six columns, which is the other three criteria as well. The anchor date 2026-09-19 is explicitly **not** claimed as a per-position verification event: nobody checked 21 positions individually that day, and a column asserting they did would be the unearned precision this register exists to avoid
- ✏️ **This ticket's own header note says the register holds 19 positions. It holds 21** — twelve Indonesian, nine Australian. The count was never recomputed after positions were added; corrected in `docs/24` too

### YT-0011 · Red-line register and enforcement
`doing` · P0 · legal · 2d · dep: YT-0010

- ✏️ **There are now ELEVEN red lines, not ten.** Red line 11 — no real personal data on Helios until its location is established by a document — was added 2026-09-21 alongside the residency decision (YT-0534). The criterion below still says "ten"; the count is the outlier, not the register
- [ ] The ~~ten~~ eleven absolute prohibitions published where product and sales will actually read them — **they are published in `docs/24`, which is where engineering reads. Whether that is where _sales_ reads is the open half**, and it is not a documentation task: red line 5 (no forward breakage claim to a merchant) is a thing a salesperson says out loud in a meeting, so the register being correct does not reach the person who can breach it
- [ ] Each red line mapped to the feature flag or code path that enforces it — **the mapping is now written** (`docs/24` § _What actually enforces each red line_, audited 2026-09-21), **and it is what proves this criterion unmet: 2 of 11 are enforced.** A mapping whose entries are mostly "nothing" is an audit, not a satisfied criterion
- [x] Jurisdiction policy service defaults set so a red line cannot be crossed by configuration alone — **met, and better than the criterion asks.** `packages/jurisdiction` makes the flags **mandatory** in the schema, so a new jurisdiction cannot be added without answering; sets `cashOutEnabled: false` and `prizeDrawsEnabled: false` for both ID and AU; defaults **stricter than the live data** (`minimumAgeYears` 21 vs 18 live, `minimumKycTier: enhanced`), so a misconfiguration fails toward caution; and `policy-data.test.ts:17-18` asserts both `false` for **every** jurisdiction, so flipping one in configuration alone turns the suite red. **That last part is what makes it a control rather than a default**
- [ ] Sales training covers the breakage-claim prohibition specifically (Scoopon precedent) — not started, and not an engineering task. The only trace in the codebase is a doc comment citing Scoopon in an onboarding page
- ⚠️ **The audit's real finding: nine of eleven red lines rest on nobody having built the thing yet, which is a different guarantee and a weaker one.** Red lines 4 (no user purchase of points) and 8 (no charitable funds held) are currently unreachable because the feature does not exist — safety by absence, which ends the day someone implements the feature correctly and innocently, **with no test failing and no reviewer alerted, because nothing anywhere states the prohibition in code**
- ⚠️ **The sharpest asymmetry**: red lines 3 and 4 are the pair that **void the counsel-substitution risk acceptance** (YT-0012) if crossed. **Red line 3 is enforced and config-proof; red line 4 is enforced by nothing at all.** Closing that one gap is the highest-value item in this ticket, and the pattern to copy is sitting in `packages/jurisdiction` already

### YT-0012 · Counsel-substitution risk acceptance
`done` · P0 · legal · 1d · dep: YT-0010

- ✅ **Signed 2026-09-21 at development stage, on the founder's explicit instruction**, recorded in `docs/24-legal-positions.md` § _Counsel-substitution risk acceptance_. Signed deliberately so this ticket stops gating **28 downstream tasks / 165d** — including YT-0048 → YT-0049, which is the bottom of the `store` epic's 92-day pricing chain
- ⚠️ **The signature is scoped and it expires.** It is a **development-stage** acceptance: no user, no entity, no regulator and no merchant exists, so the risk accepted is currently theoretical. **It must be re-executed by the founder personally — reading it, not instructing it — on the earliest of: first real user · entity formation (YT-0013) · PSE registration (YT-0014) · any regulator contact.** That re-execution is a criterion of **YT-0013** and should fail loudly if skipped
- ⛔ **Void, not merely expired, if red line 3 or 4 is crossed** — shipping a user purchase of points, or shipping cash withdrawal. Those are the premises ID-1 and ID-2 rest on, so crossing either does not weaken the acceptance, it removes the thing being accepted
- [x] Founder signs off, in writing, on proceeding without advisory counsel — instruction given in session `yourtal-a4`, dated and attributed in the register. **What is recorded is the instruction to proceed, not a representation that each clause was personally read** — the narrower claim is the honest one, and it is why the re-execution condition exists
- [x] The concentration of exposure in ID-1/ID-2 (points as e-money) explicitly acknowledged — both named with their **Medium** confidence, and the consequence stated: if a regulator looks through the structure to substance, the platform is an unlicensed payments business. The two structural facts that keep the acceptance narrow (no point purchase, no cash withdrawal) are bound to it as the lapse condition above
- [x] Triggers that force engaging counsel regardless of budget agreed and recorded — the six existing triggers adopted by reference. **Two of them carried no number** (*"revenue above a set threshold"*, *"a merchant dispute above a threshold"*); both are now `any`. Chosen over a figure because `any` is **definite** — the property that was missing — and errs toward more counsel rather than less, so it is safe to set at development stage. Neither can fire yet: there is no revenue and there are no merchants
- [x] Budget line reserved for one narrow opinion on the e-money question in Indonesia — **scope and trigger committed, amount deliberately not invented.** A figure made up by a session to clear a checkbox is the settlement-materiality failure with a currency symbol on it. The amount attaches at **YT-0013**, the first point real money is committed to Indonesian structure, and is a criterion of it
- ℹ️ **Found while drafting, and it is the reason drafting was worth doing**: the trigger table had carried two unnumbered thresholds since it was written. A threshold with no number cannot be crossed — the same defect as the 20% settlement-materiality placeholder removed earlier the same day, sitting undetected in the legal register. It surfaced only because writing the sign-off forced the triggers to be read as things someone would have to act on
- ✅ **Verified 2026-09-21 by `yourtal-ca`, which wrote none of this work, against the bar its author stated rather than a general one.** `docs/24`'s counsel-substitution section carries every element unambiguously: development-stage scope, the **narrowed** claim (an instruction to proceed, not a clause-by-clause reading), expiry on the earliest of four named triggers, **void rather than expired** if red line 3 or 4 is crossed, both previously-unnumbered thresholds now literally `any`, and the budget committed as scope-and-trigger with the amount deferred and the reason given. **A reader could not come away thinking this is a durable general acceptance**, which is the thing a risk acceptance most often fails at
- 🚨 **It points three times at an expiry mechanism that does not exist, and this is rule 10's family.** YT-0012 asserts twice — and `docs/24` once more — that the personal re-execution *"is a criterion of YT-0013"* and that the budget amount *"attaches at YT-0013 and is a criterion of it"*. **YT-0013's four criteria are notaris engaged, corporate services engaged, structure confirmed, formation instructed. Neither re-execution nor the amount is among them.** So the mechanism that makes this signature honest is carried nowhere, and it bites precisely when YT-0013 is worked — which is itself one of the expiry triggers
- ℹ️ **The defect belongs to YT-0013 and this ticket keeps a pointer**, per the one-home-plus-pointer rule. YT-0013 needs those two criteria added. Separately: **YT-0013 is estimated 10d, double rule 3's ceiling** — the second breach in `legal` after YT-0015 at 8d
### YT-0013 · Entity formation via notaris and corporate services
`todo` · P0 · legal · 10d · dep: YT-0012

- [ ] **Notaris engaged** — PT/PT PMA formation is a notarial act and has no research substitute
- [ ] Local corporate services provider engaged for OSS, NIB and domicile
- [ ] PT PMA (Indonesia) and Pty Ltd (Australia) structure confirmed, with the ≥15% local ownership path
- [ ] Formation instructed

### YT-0014 · PSE registration (Indonesia)
`todo` · P0 · legal · 5d · dep: YT-0013

- [ ] Registered with Komdigi via OSS as a private-scope ESO
- [ ] Registration number recorded and displayed as required

### YT-0015 · Consumer-facing legal copy
`todo` · P0 · legal · 8d · dep: YT-0010

- [ ] T&Cs, privacy policy and points terms drafted per jurisdiction, in Bahasa and English
- [ ] Drafted against the positions register and published regulator guidance, not from a generic template
- [ ] Consent text versioned and wired to the consent service schema
- [ ] Points expiry, transfer and forfeiture rules stated plainly, in language a user actually understands

### YT-0016 · Tax position on marketplace withholding
`todo` · P0 · legal · 3d · dep: YT-0010

- [ ] Indonesian marketplace withholding obligations on seller income confirmed with a tax consultant
- ⏭️ **This is the one position the register rates Low confidence and it is financial, not theoretical.** Converted 2026-09-21 — flagged by `yourtal-08`'s board scan and **judged by this session as the owner of `legal`**, which is the right way round: a scan proposes, the epic owner rules. It is an argument for the ticket's priority, so no implementation can tick it. **The other flagged-looking line stays a criterion**: "settled before the first merchandise order, not after" reads like sequencing but is a real bar — it is checkable at any moment, and failing it is a state the ticket can actually be in
- [ ] Settled before the first merchandise order, not after

## Infrastructure

### YT-0527 · Cerbos in the integration workflow
`done` · P0 · infra · 1d · dep: YT-0516
- [x] ⚠️ **Had never run.** The repository had no remote until 2026-09-20, so this workflow had executed zero times when these boxes were first ticked. Its first real execution died in `Initialize containers`, before any test. **Now green**: run `35489234086`, `apps/api` 26 files against a live PDP
- [x] The 403-before-any-rule regression (YT-0500, `policies/_schemas/resource/business.json`'s comment on `businessId`) is exactly the class this catches — sabotage-tested: re-required `businessId` on the schema, `app.boot.test.ts`'s create case failed with `expected 403 not to be 403`, reverted, green again
- [x] ⚠️ **Was ticked on reasoning, and the reasoning was wrong.** A service container starts before `actions/checkout`, which the note acknowledged — but the argument that `watchForChanges` covered it fails because **that setting lives in `config.yaml`, which failed to mount for the identical reason**. Docker created a *directory* at `/config/config.yaml`, Cerbos logged `Loading configuration from __default__` and `Found 0 executable policies`, and the healthcheck ran against a directory. **The compensating control was disabled by the fault it was compensating for** — invisible to any amount of reading, visible the instant it ran. See [`docs/13d`](../13d-lessons.md) §3
- [x] Same no-skip posture as the Postgres suites: a dedicated `Assert apps/api reported nothing skipped` step, mirroring the Go ledger's SKIP guard
- [x] **Fixed 2026-09-20**: Cerbos moved out of `services:` and into a post-checkout `docker run` step, so it mounts a repository that exists
- [x] A readiness wait that asserts **policies actually loaded**, not merely that the container is healthy. **A PDP with zero policies is healthy and answers DENY to everything** — it looks like a working PDP while refusing every request, which is what hid here
- [x] **Proved by a green `Integration` run on GitHub** (`35489234086`), not by local reasoning — and the wait step asserts **`Found 16 executable policies`**, because a PDP with zero policies is healthy and denies everything
- Also added `apps/api/src/app.boot.test.ts` (boots the real `AppModule`, calls it over real HTTP against a live Cerbos — no `fetchImpl` override anywhere in it) and fixed a live drift: `env.schema.ts`'s `PDP_BASE_URL` default was `:3592` (Cerbos's own default) while `docker-compose.yml` and `.env.example` both map it to `:26592` — a bare `pnpm dev`/`pnpm test` with no `.env` was pointing at a port nothing binds locally, and on this machine `:3592` happens to have an unrelated project's Cerbos listening, which would have been a silent cross-project policy mix-up. Fixed and pinned with a drift test, `env.schema.test.ts`, per docs/13's "guard the copy" rule
- Verified 2026-09-19 against the real local stack (`pnpm dev:up`, Cerbos on 26592): `pnpm --filter @yourtal/api test` — 23 files, 96 tests, all green; typecheck and lint clean
- Trigger paths widened to `apps/api/**`, `packages/authz/**`, `policies/**`, `infra/cerbos/**` — previously the workflow would not even run on changes to any of these


- ✅ **Verified 2026-09-21 by `yourtal-22`, which did not write this ticket.** `integration.yml` runs Cerbos as a **post-checkout `docker run`** (`:162-166`), mounting `$GITHUB_WORKSPACE/infra/cerbos/config.yaml` — so it mounts a repository that exists, which is the whole fix. The no-skip guard is a real step, *"Assert apps/api reported nothing skipped"* (`:239`), mirroring the Go suites
- ✏️ **One ticked bullet describes the readiness assertion more strongly than the workflow implements, and the criterion still holds.** It says the wait step asserts **`Found 16 executable policies`**. What `:181` actually does is fail on `Found 0 executable policies` and then echo the count at `:186` — a **non-zero** check, not a sixteen check. The criterion it serves is *"asserts policies actually loaded, not merely that the container is healthy"*, and non-zero satisfies that exactly; a PDP with zero policies is healthy and denies everything, which is the trap named. But **a single loaded policy would also pass**, so the bullet's specific number is not enforced anywhere. Recorded rather than re-ticked: pinning the count would make the gate fail on every legitimate policy addition, so the looser check is probably the right design and the prose is what should change
### YT-0516 · Local development stack — **no cloud account needed**
`done` · P0 · infra · 1d · dep: —

- [x] `docker-compose.yml` running **Postgres 17**, a **Cerbos 0.55.0** sidecar and **Valkey 8**, all loopback-bound on ports 26432 / 26592 / 26379 — chosen to miss the four other Postgres instances already on this machine. All three healthy
- [x] `.env.example` covering every variable `apps/api` reads, plus `pnpm dev:up` / `dev:down` / `dev:reset` / `dev:logs` / `dev:psql`
- [x] `apps/api` **boots** against it — handed to the Phase 0 owner to verify
- [x] Cerbos serves **real decisions**, not `cerbos compile` assertions. Verified with a live check; **schema enforcement is `reject`**, and the smoke request was correctly refused for a missing `jurisdiction` / `businessRoles` / `isSuspended` principal attribute
- [x] Six domain schemas and **separate `yourtal_ledger` / `yourtal_app` roles** created at init, with the app role revoked from the ledger schema — so a cross-module read fails as a permission error locally, per `docs/13`
- Runtime config lives in `infra/cerbos/config.yaml`, deliberately **not** in `policies/`, so the policy repo stays exactly what CI compiles
- ⚠️ **This should have existed from day one and its absence is a planning error of mine.** YT-0022 provisions _managed_ Postgres in GCP for _deployed_ environments; nothing about local development needs a cloud account. Treating them as the same dependency is why the idempotency store is in-memory and per-process, why every Drizzle line is typechecked but never executed, why there are zero migrations, and why `main.ts` has never started
- [x] **`apps/api` booted for the first time**, all nine routes mapped. Two real blockers: Node's type stripping cannot resolve this repo's extensionless imports, and esbuild cannot emit the decorator metadata NestJS DI needs — `@swc-node/register` does both. Live smoke through **real Cerbos and real Postgres**: anonymous → 401, create → 201, same key + same body → 201 with the identical id, same key + different body → 409, and the database confirms exactly one business row and one owner membership

- ✅ **Verified 2026-09-21 15:16 by `yourtal-22`, which did not write this ticket. Every bar re-measured from the running system, not from the test suite** — deliberately, because YT-0547 shows a suite result here depends on who else is running, and none of the evidence below does.
  - Compose: `postgres:17-alpine`, `ghcr.io/cerbos/cerbos:0.55.0`, `valkey/valkey:8-alpine`, bound `127.0.0.1:26432/26592/26379`, all reporting healthy
  - Cerbos serving a **real decision**: a live `POST /api/check/resources` returned `EFFECT_DENY` with `validationErrors` naming exactly the missing `jurisdiction`, `businessRoles` and `isSuspended` — the ticket's own wording, reproduced. `enforcement: reject` confirmed at `infra/cerbos/config.yaml:30`
  - Role isolation proved by asking Postgres rather than reading DDL: `has_schema_privilege('yourtal_app','ledger','USAGE')` → **`f`**
  - `apps/api` **boots**: `Nest application successfully started`, **31** routes mapped, and an anonymous `POST /api/businesses` is refused
- ✏️ **Three figures in this ticket have drifted upward since it was written. Ticks stand; the numbers are corrected here rather than edited away, because the drift is the healthy direction and hiding it would lose the fact that this ticket is now describing a smaller system than exists.**
  - *"Six domain schemas"* → **seven**: `business`, `campaign`, `ledger`, `platform`, `store`, `voucher`, `watch`
  - *"all nine routes mapped"* → **31**
  - *"anonymous → 401"* → **403**. The refusal still happens, which is the bar; what changed is which refusal, once YT-0500 put the PDP in front of the route. A criterion naming a status code rather than *"an anonymous request is refused"* is `_schema.md` rule 2 in miniature
- ℹ️ **`/healthz` returns 404; the health route is `/api/health`.** Recorded because the first probe here used the wrong path and nearly became a finding against YT-0556. The route table, not the guess, settled it
### YT-0517 · Declare `services/*` and scaffold the Go module
`done` · P0 · infra · 1d · dep: YT-0516

- [x] `services/*` now declared in `pnpm-workspace.yaml`
- [x] Scaffold `services/` as one Go module per `docs/13a`, with `go build` and `go vet` in CI
- [x] **Zero Go service code exists today.** The only Go is generated types under `packages/contracts/openapi/go/`, and those are **untracked** — `git ls-files` returns nothing, so CI regenerates them and no reviewer ever sees them in a diff
- [x] `services/ledger` on Go 1.26 + chi. Builds and vets clean, runs, `/healthz` 200, unknown paths return the `docs/13` §5 envelope. **Verified independently: `go build ./...` exit 0**
- **Its own Go module, not one at the repo root** — a shared module lets the voucher service import the ledger's internals by accident; per-module means `internal/` means what it says. Cost is a CI matrix row per service, which is friction in the right direction
- **Deliberately contains no double-entry logic.** Those invariants exist and are enforced in Postgres (YT-0518). Writing a Go implementation of them before YT-0506 settles the money unit would be writing code against a number whose meaning is still open

- ✅ **Verified 2026-09-21 by `yourtal-22`, which did not write this ticket.** `pnpm-workspace.yaml:6` declares `services/*`; there are now **two** Go modules, `services/ledger/go.mod` and `services/voucher/go.mod`, which is the per-module choice this ticket argued for rather than one at the repo root. `go build ./...` and `go vet ./...` both exit **0** in `services/ledger`, re-run here rather than accepted — and neither touches Postgres, so unlike a vitest suite this evidence is unaffected by YT-0547's contention
- ✏️ **The third box is a finding, not a criterion, and it has since become false — which is the point of recording rather than re-ticking it.** It reads *"Zero Go service code exists today"*, true when written and now **67 Go files** across the two services. As a bar it is unfalsifiable-in-reverse: the ticket's own success makes it false. `_schema.md` rule 1 covers this — an observation that motivated the work is a note, and the form for it is `- ℹ️`, not a box
### YT-0518 · First migration, executed
`done` · P0 · value · 2d · dep: YT-0516, YT-0043

- [x] **There are zero `.sql` files in the repository.** Atlas is the chosen migration tool (`docs/15`) and has never been run
- [x] Generate and apply the first migration against local Postgres, including `IDEMPOTENCY_TABLE_DDL`
- [x] Prove the ledger constraints from YT-0041 actually reject an unbalanced transfer **in the database**, not only in a unit test
- [x] `packages/db` with Atlas, **three migrations applied** against live Postgres: `platform.idempotency`, ledger, business. Atlas **pinned by digest, not tag** — `:latest` is a moving canary, and a migration tool that differs between a developer and CI is a bad surprise in the one process that edits production schemas
- [x] **Ledger rejects an unbalanced transfer in Postgres — independently verified.** A single-entry transfer fails at COMMIT: `ledger: transfer spot-t1 has 1 entries; double-entry needs at least 2`, from `ledger.assert_transfer_balanced()` with no service in the path. Also proved: zero-amount rejected, duplicate idempotency key rejected, `yourtal_ledger` denied UPDATE/DELETE, `yourtal_app` denied the ledger schema entirely
- **A DEFERRED constraint trigger, not a CHECK, and the reasoning is worth keeping:** a CHECK sees one row, and _"these rows sum to zero"_ is a statement about a set. It also cannot fire per-statement, because a transfer is legitimately built from several INSERTs. **Deferring to COMMIT is what makes the invariant absolute rather than "absolute except while we are mid-write"**
- Money columns are `bigint` minor units plus explicit currency. **This does not settle YT-0506** — that question is which integer a given amount _is_, and bigint is right under either answer
- **Defect found by YT-0043 and fixed:** `UNIQUE (owner_type, owner_id, currency)` encoded *one account per owner per currency* — right for a user, wrong for the platform, which needs issued, redeemed, breakage and marketing accounts at once. **A chart of accounts IS several accounts for one owner in one currency, so the constraint forbade the thing it existed to support.** Now a partial unique index over `user`, `merchant`, `charity` only, with both halves tested so the correction does not over-correct
- ✅ **Verified 2026-09-21 by `yourtal-ca`, which wrote none of this work, and the criterion that matters was proved IN THE DATABASE with no service in the path.** Inside a transaction forced with `SET CONSTRAINTS ALL IMMEDIATE` and rolled back, so nothing persisted:
  - single-entry transfer → `ERROR: ledger: transfer … has 1 entries; double-entry needs at least 2`
  - two entries summing to **+100** → `ERROR: ledger: transfer … is unbalanced by 100`
  - both rolled back clean, `select count(*) … where transfer_id = …` → **0** leftovers each time
- ✅ **The trigger's deferredness confirmed from the catalogue rather than the DDL**: `pg_trigger` → `entry_balances_at_commit | tgdeferrable=t | tginitdeferred=t`. That is the *"absolute rather than absolute-except-while-mid-write"* claim checked at the source of truth
- ✅ Grants from the live database: `has_table_privilege('yourtal_ledger','ledger.entry','UPDATE'|'DELETE')` → **f | f**, `has_schema_privilege('yourtal_app','ledger','USAGE')` → **f**. And YT-0043's correction is genuinely in place — `account_one_per_owner_currency` is `UNIQUE … WHERE owner_type = ANY (ARRAY['user','merchant','charity'])`, **partial**, so the platform can hold issued / redeemed / breakage / marketing accounts at once. Atlas pinned by digest at `atlas.mjs:29`, not by tag
- ✏️ **Criterion 2 names a mechanism that stopped existing tonight**: *"including `IDEMPOTENCY_TABLE_DDL`"*. **YT-0039 deleted that constant hours ago** — the migration `20260919000001_platform_idempotency.sql` is the sole creator and it applied. Property met, wording stale, and the two tickets now disagree in writing. Corrected here while YT-0039's promotion is fresh rather than left for whoever finds the contradiction later
- ℹ️ Criterion 1 — *"There are zero `.sql` files in the repository"* — is a statement of the **problem**, not a bar this ticket meets, which is `_schema.md` rule 1's shape. Ticked and the work is done; flagged because it reads oddly to anyone auditing criteria
### YT-0519 · Seed the real database from the mock generators
`doing` · P0 · data · 2d · dep: YT-0518, YT-0600

- ❌ **Failed independent verification 2026-09-21 (`yourtal-a4`), returned from `review`.** One ticked criterion is false against the code, which is the second sampled review in a row to fail — see the dashboard's note that `review` → `done` is work rather than a formality

- [x] `pnpm db:seed` loads the **existing deterministic generators** in `packages/contracts/*.mock.ts` into local Postgres — same data, real tables
- [ ] Phase U surfaces read it through `apps/api`, not from in-process fixtures — **FALSE, was ticked.** The seam exists and is well built (`resolveDataSource` in `packages/contracts/src/mock-source.ts`, one switch, fails fast on a bad value), but **all 13 of its live implementations are `Promise.reject("Live … data source is not implemented yet (Phase U is mock-only).")`**, and `YOURTAL_DATA_SOURCE` defaults to `"mock"`. `apps/web/features/**` contains **zero `fetch(` calls** and **no API base URL of any kind** (`API_BASE_URL`, `NEXT_PUBLIC_API*` — no matches outside `.next/`), so the web app cannot reach `apps/api` at all. `apps/web/features/public/public-campaign-data.ts` states it outright: _"Fixed catalogue only, no `mock-source`/live seam — Phase U ships no BFF."_ **The database is seeded and nothing reads it.** Commands: `grep -rn "is not implemented yet" apps/web/features` (13, excluding tests), `grep -rn "fetch(" apps/web/features` (0), `grep -rn "API_BASE_URL|NEXT_PUBLIC_API" apps/web` (0 outside `.next/`)
  ⛔ **This criterion cannot close, and the work behind it is unticketed — which is the more useful finding.** Searched 2026-09-21: **no ticket owns wiring `apps/web` to `apps/api`.** The closest, YT-0583, carries a BFF criterion whose own note already records that it has no consumer. So YT-0519 sits at **6/7**, held open by a subsystem nobody has been asked to build. **Deliberately not reworded to fit what exists** — unlike the `dev:fresh` line below, where the criterion named the wrong command for work that *was* done, this one names the right thing and the thing is absent. Narrowing it would be an author trimming their own bar to reach it. Someone owning `web` or `platform` should file the BFF ticket, and this criterion should then depend on it. Same shape as YT-0133, which was blocked on two service APIs that also had no ticket.
- [x] Seed is idempotent and re-runnable; **`pnpm dev:fresh`** rebuilds it — **reworded 2026-09-21 and now met.** The criterion named `dev:reset`, which does not rebuild anything: it is `docker compose down -v && docker compose up -d --wait`, running neither `db:migrate` nor `db:seed`, so it destroys the volume and leaves an **empty** database. `seed.ts:417` says so in its own success message — _"use `pnpm dev:fresh` for a clean slate"_ — so the code and the criterion had disagreed since the code was written. **Reworded rather than made true**, because the alternative — teaching `dev:reset` to reseed — would leave a `down -v` behind a friendlier name.
  **Evidence, by composition rather than execution**, since running it would destroy every other session's database in the shared cluster: idempotency is verified at source — every insert in `packages/db/src/seed.ts` is `ON CONFLICT … DO NOTHING` and the generators are seeded, so ids are stable — and `dev:fresh` is literally `dev:reset && db:migrate && db:seed && media:publish`, each of whose parts is separately verified. **Stated as composition, not as a run**, so nobody later reads this as "someone watched it work end to end".
  ⚠️ **"False" undersells it** (`yourtal-c8`): `dev:reset` **is** `docker compose down -v`, the one command this board carries a standing 🛑 warning against, because it destroys the worktree databases other sessions are running against. So a ticked criterion instructs the reader to run the forbidden command **and** leaves them with an empty database afterwards. Anyone fixing this should use `pnpm dev:fresh`
- [x] Includes the awkward fixtures YT-0403 already defines: long merchant names, zero balance, expired voucher, sold-out listing
- **This is what turns "it works against mocks" into "it works against the stack."** Fixtures cannot surface contract drift, N+1 queries, serialisation bugs, missing indexes or the seam failures this repo has already hit twice. The data stays synthetic; the path becomes real
- [x] Migration 4 first — `campaign`, `store` and `voucher` schemas existed with **zero tables**, so there was nothing to seed into. Tables shaped exactly as `packages/contracts` defines them, so a column disagreeing with a Zod field is now a bug in one of the two
- [x] **Verified independently:** 24 campaigns, 30 listings, 60 vouchers; re-run writes 0; **zero vouchers disagree with their listing**; and `listings_settlement_within_face` rejects a settlement above face value at the database
- ⚠️ **The counts above no longer match the running database**, which is why a number in a criterion is a poor criterion. Measured 2026-09-21 against `yourtal-postgres`: **36 campaigns, 32 listings, 86 vouchers** (`campaign.campaigns`, `store.listings`, `voucher.vouchers`). Most likely later seeding — the AU region fixtures land after this was written — rather than a defect, so the criterion stays ticked. `listings_settlement_within_face` **does** exist in `pg_constraint` and was re-confirmed. Left as a note because a criterion asserting a row count is stale the moment anyone adds a fixture
- [x] `pnpm dev:fresh` — reset, migrate, seed. One command from nothing to a working stack
- **The lost `.refine()` rules are now in Postgres**, closing the loop from `docs/13`: quick campaigns ≤ 60s, accuracy bonus requires questions, stock within total, sold_out has no stock, minimum_spend iff threshold, and **settlement within face value** — an economic invariant, not a formatting rule. Settlement above face means the platform pays out more than the voucher was ever worth, silently, on every redemption

### YT-0520 · Local identity provider
`done` · P0 · platform · 1d · dep: YT-0516

- [x] Zitadel in `docker-compose`, so OIDC is a real provider issuing real tokens locally
- [x] Replaces the `x-yt-user-id` header seam, which already has a production boot-guard and should not outlive it
- [x] YT-0032 then covers **deployment and realm configuration only**
- [x] **Zitadel v2.66 live at `http://localhost:26080`**, backed by its own database in the same Postgres. OIDC discovery serving; bootstrap login `dev@yourtal.local` / `DevPassword1!`
- Note for implementers: Zitadel's `ExternalDomain` is `localhost`, so requests must use `http://localhost:26080` — `http://127.0.0.1:26080` returns _Instance not found_, which looks like a broken container and is not one
- ✅ **Verified 2026-09-21 by `yourtal-ca`, which wrote none of this work.** `zitadel` is a service at `docker-compose.yml:90`, and OIDC discovery is genuinely **serving**: `GET /.well-known/openid-configuration` returns a real document carrying `issuer`, `authorization_endpoint`, `token_endpoint` and `introspection_endpoint`. **Not a container that is merely up — a provider answering the endpoint that matters**, which is the distinction a healthcheck cannot make
### YT-0521 · Local object storage and media origin
`done` · P0 · media · 2d · dep: YT-0516, YT-0220

- [x] MinIO in `docker-compose` — S3-compatible, so the R2 adapter is exercised rather than stubbed
- ⚠️ **This criterion appeared twice in this task, once ticked and once not** — the ticked copy is removed. `review` does not enforce all-boxes-ticked the way `done` does, so a self-contradicting task sat at `review` and made YT-0526 read as unblocked when its dependency was not met. Found 2026-09-20
- [x] **Per-segment delivery logs are the control Cloudflare Stream could not give us** (`docs/22`), so this is the first place attention verification can actually be proved
- [x] **MinIO live at `http://127.0.0.1:26900`** (console 26901), S3-compatible, so the R2 adapter is exercised rather than stubbed
- [x] **Local HLS origin serving real segments — built. `packages/media`, 15 tests, green.** `pnpm media:publish`; the manifest is `http://127.0.0.1:26900/yourtal-media/hls/attention-30s/index.m3u8`. Published through `@aws-sdk/client-s3`, not `mc` — the reason MinIO exists is that the R2 adapter is exercised rather than stubbed, and a `docker exec … mc cp` publish path exercises nothing that will exist in production. Anonymous `GetObject` is granted on the `hls/` prefix only, because `S3_BUCKET` is the whole stack's bucket and KYB documents land there too
- [x] **Per-segment delivery logging proved, not asserted** — `delivery-log.test.ts` fetches three of five segments and reads MinIO's own request trace back: one record each, with bytes delivered, and **no record for the two segments nobody asked for**. That negative half is the test; without it the check would pass against a log that recorded everything indiscriminately. This is the per-segment granularity `docs/22` found Cloudflare Stream does not expose at any price
- [x] ⚠️ **It is an upper bound, not proof of attention.** `docs/22` is explicit that client-side buffering counts as delivery and a `curl` loop can pull every segment in seconds. Promoting a ceiling to a primary defence is the mistake `docs/08` made; this makes the ceiling measurable and claims nothing more. Attributing a fetch to a **session** needs signed per-session URLs (`docs/22` option A) and is the hardening step
- [x] **Three renditions with a master playlist, not one stream.** A single-rendition fixture would have closed YT-0412's seeking gap and opened a quality-selection one: `video-source.ts` says the Apple placeholder was chosen precisely because it ships a real ABR ladder. `BANDWIDTH` is asserted to rise monotonically, because hls.js selects on it and a ladder whose top rung advertises less than its middle selects incoherently
- [x] Committed (2.7 MB) rather than generated at install, so a working stack does not need ffmpeg; `scripts/generate-fixture.mjs` makes it reproducible and `hls-fixture.test.ts` asserts the committed files still match what that script describes
- **Found while building:** ffmpeg on Windows wrote `v0\index.m3u8` into the master playlist, because it copies the path separator it was handed. A backslash is not a valid URI path — the master would have listed three renditions and every one would have failed to resolve, i.e. broken everywhere except where you look first. Caught by the fixture test. `.prettierignore` also needed the fixture directory: MPEG-TS segments are named `.ts`, so Prettier picked its TypeScript parser and failed the format gate on binary video
- ⚠️ Image is `quay.io/minio/minio:latest`; Docker Hub's `minio/minio` is no longer public. **Pin by digest**, per the Atlas lesson in YT-0518

- ✏️ **Cites `apps/web/features/player/video-source.ts`, which no longer exists — and the work it described was not lost, it was promoted.** Added in `316cd53`, deleted in `9bd450d`. `MOCK_HLS_MANIFEST_URL` now lives in `packages/contracts/src/campaign/campaign.mock.ts:46` with its own guard, `hls-fixture-url.test.ts`, and the "KNOWN GAP" that file carried — *`campaignSchema` has no video-source field at all* — was closed by YT-0503. **The citation is stale; the criterion it supports is not weakened.** Found 2026-09-21 by `yourtal-22` sweeping every path cited by a `review` ticket against the tree
- ✅ **Verified 2026-09-21 by `yourtal-ca`, which wrote none of this work, and the security claim was proved by ATTEMPTING the thing rather than reading the policy**: the manifest returns **200** anonymously while `GET /yourtal-media/kyb/anything.pdf` returns **403**. That is the criterion's real bar — `S3_BUCKET` is the whole stack's bucket and KYB documents land in it — so an `hls/`-only anonymous grant is the control, not a convention
- ✅ Three renditions with a real master playlist, fetched from the live origin: `#EXT-X-STREAM-INF` at **320x180 / 480x270 / 640x360** pointing at `v0/`, `v1/`, `v2/`. **A single-rendition fixture could not have produced that**, which is what makes the quality selector testable at all
- ✏️ **The manifest URL in this ticket was wrong by two characters and returned `NoSuchKey`. Corrected here from `attention-20s` to `attention-30s`.** Every other reference in the repository already agreed — `campaign.mock.ts:49`, `hls-origin.ts:55` (`FIXTURE_ASSET_ID = "attention-30s"`), `generate-fixture.mjs:62`, the fixtures directory, and **this ticket's own neighbour in `phase-0-web.md:47`, which states the correct URL and records verifying it with `curl`**. The only occurrence of `attention-20s` in the entire repo was this criterion
- ⚠️ **A live URL inside a criterion is a cross-reference that other tickets consume, and it fails the same way as YT-0012's dangling pointer.** YT-0412's player work would have copied this straight out of the ticket and got `NoSuchKey` — a two-character error propagating into someone else's afternoon
### YT-0522 · Split cloud tasks into local and deployed
`todo` · P0 · infra · 1h · dep: YT-0520, YT-0521

- [ ] YT-0020/0021/0022/0024/0025/0026 are re-scoped to **deployment only** in their titles and bodies
- [ ] Every downstream task now depends on a **local** capability that exists today
- [ ] A task blocked on a cloud account must say so explicitly, so the distinction never silently returns

### YT-0020 · GCP organisation, projects, billing, IAM baseline
`todo` · P0 · infra · 3d · dep: —

- **Deferred 2026-09-19 — Helios is the deployment target (YT-0529).** Kept because a two-region managed deployment is still the right production answer; it is no longer on the critical path and gates nothing.
- [ ] Separate projects per environment and per region; least-privilege IAM; no owner-role humans
- [ ] Budget alerts configured

### YT-0021 · Terraform skeleton and two data planes
`todo` · P0 · infra · 5d · dep: YT-0020

- **Deferred behind YT-0529.** The two-data-plane shape is the *policy* (`docs/02` country isolation) expressed as Terraform. Helios satisfies neither region; see YT-0534 for what that forbids us from storing there.
- [ ] One module instantiated twice: `asia-southeast2` (Jakarta) and `australia-southeast1` (Sydney)
- [ ] No resource can be created outside a region module
- [ ] `terraform plan` clean in CI

### YT-0022 · PostgreSQL provisioned per region
`todo` · P0 · infra · 3d · dep: YT-0021

- **Deferred behind YT-0531**, which provides Postgres on Helios with an actually-executed restore. Managed HA and PITR return with production.
- [ ] HA managed instance per region, PITR enabled, restore tested once
- [ ] Separate database roles per domain schema; ledger role isolated

### YT-0023 · Redis provisioned per region
`todo` · P0 · infra · 1d · dep: YT-0516

- Re-parented onto the local stack (YT-0516): this needed _a_ service, not a _managed_ one. The cloud task now covers deployment only.
- [ ] Managed instance per region, TLS, auth enabled

### YT-0024 · Cloud Run, Artifact Registry, deploy pipeline
`todo` · P0 · infra · 4d · dep: YT-0021

- **Superseded for now by YT-0532** (artifact build + verify + health-check + rollback on Helios). The acceptance criteria below are unchanged in substance — only the runtime differs.
- [ ] Container build + deploy from CI to staging on merge, prod on tag
- [ ] Rollback is one command and is tested

### YT-0025 · Cloudflare: domains, CDN, R2, Stream, Turnstile
`todo` · P0 · infra · 3d · dep: —

- **Deferred.** Turnstile is simulated by YT-0538, object storage is MinIO locally, and video was already re-parented onto self-hosted HLS (YT-0220). What genuinely remains is **a domain and DNS**, which is now the only piece of this task on anyone’s path.
- [ ] Domains and DNS under Cloudflare; WAF baseline on
- [ ] R2 buckets per region-role; Stream account with signed uploads
- [ ] Turnstile site keys issued per environment

### YT-0026 · Secret Manager and KMS keyrings
`todo` · P0 · infra · 2d · dep: YT-0020

- **Deferred behind YT-0533**, which keeps the *key separation* — voucher codes, PII, signing — while custody moves to the host. The separation is the part that must not be lost; the KMS is an implementation of it.
- [ ] Keyring per region; separate keys for voucher codes, PII, signing
- [ ] No secret in any env file in the repo; secret scanning in CI

### YT-0027 · Observability: OpenTelemetry, Grafana Cloud, Sentry
`todo` · P0 · infra · 4d · dep: YT-0516

- Re-parented onto the local stack (YT-0516): this needed _a_ service, not a _managed_ one. The cloud task now covers deployment only.
- [ ] Traces, metrics and logs from the first service, tagged by region
- [ ] Four golden signals dashboard; on-call alert routes defined

### YT-0028 · CI pipeline with all gates
`todo` · P0 · infra · 4d · dep: YT-0030

- [ ] Gates: lint, types, unit, integration, file-length, bundle size, Lighthouse CWV, migration safety, secret scan, SBOM
- [ ] `node scripts/tasks.mjs --check` runs and fails on a stale dashboard

### YT-0602 · Red line 4 voids the risk acceptance and nothing enforces it
`todo` · P0 · legal · 3d · dep: YT-0011

- ⛔ **Filed 2026-09-21 by `yourtal-fe` from `yourtal-28`'s YT-0011 audit.** Red lines **3 and 4** are the pair that make the YT-0012 counsel-substitution acceptance **void rather than expired** if crossed. **Red line 3 is enforced and configuration-proof. Red line 4 is enforced by nothing at all.**
- ⚠️ **The asymmetry is the whole finding.** A risk acceptance whose voiding conditions are half-enforced is an acceptance that can be voided silently — the signature stops being valid and no signal anywhere says so. That is worse than an unenforced prohibition on its own, because the register still reads as though the acceptance stands
- ℹ️ **Red line 3 shows what "enforced" looks like here, and it is copyable.** `packages/jurisdiction` makes the flags **mandatory** in `policy-schema.ts`, so a new jurisdiction cannot be added without answering the question; schema defaults are **stricter than the live data** (`minimumAgeYears` 21 against 18 live, `minimumKycTier: enhanced`), so a misconfiguration fails toward caution; and `policy-data.test.ts:17-18` asserts the flags `false` for **every** jurisdiction, so flipping one in configuration alone turns the suite red. **The test is what makes it a control rather than a default**
- ⚠️ **"Not yet built" is not "forbidden", and this is where the two get confused.** Red lines 4 and 8 are unreachable today only because the feature does not exist — safety by absence. **That ends the day someone implements the feature correctly and innocently, with no test failing and no reviewer alerted**, because nothing states the prohibition in code. Same shape as `perUserLimit` stored and never read, and `IDEMPOTENCY_TABLE_DDL` exported and never imported
- [ ] Red line 4 is enforced in code by the YT-0011 pattern — a mandatory flag, a default that fails toward caution, and a test that fails if the flag is flipped by configuration alone
- [ ] **A test fails if the prohibition is removed**, not merely if it is violated, so safety-by-absence cannot be mistaken for enforcement
- [ ] Every red line that **voids** the YT-0012 acceptance is enforced to the same standard, **stated as a property** — a criterion naming only red line 4 leaves the next voiding condition to be found the same way
