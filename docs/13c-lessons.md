# 13c · Lessons the hard way

Split out of [`13-engineering-standards.md`](13-engineering-standards.md) on 2026-09-20 when it crossed the 300-line ceiling. Those are the **standards** — what to do. These are the **incidents** — what went wrong, and the rule each one bought. Every entry here was paid for. **Continued in [`13d-lessons.md`](13d-lessons.md)**, which covers the day the first CI run in this repository's history executed — and failed six ways.

## The one thing all of these have in common

Ten gates in a week reported success while covering less than their names claimed. The mechanisms were all different — a skip, a regex, a NULL, a scoped filter, a config override, an unused role, an idempotent no-op — and hunting for a mechanism is how you miss the next one.

**What they share is that none could be caught by reading the assertion.** Every one was correct about the case it was shown. They differed only in what they were never shown:

| The check              | What it was never shown                 |
| ---------------------- | --------------------------------------- |
| CI guarantees          | Any Postgres-backed test                |
| Two ledger proof tests | The run where they did not skip         |
| `openapi:go:check`     | Anything other than its own output      |
| YT-0521 at `review`    | Its own second, contradicting criterion |
| `turbo run lint`       | 486 of 565 files                        |
| A player e2e spec      | That its assertion described an attack  |
| A PII `CHECK`          | A NULL                                  |
| A dead-host sabotage   | That the config overrode it             |
| A seed coherence scan  | That its filter matched nothing         |
| A schema-drift regex   | Any column containing a digit           |

**So the review question is not “is this green”, or even “is this asserting the right thing”. It is: _what does this check do with the case it was not shown?_** If the answer is “nothing, quietly”, then its coverage is whatever the input happened to contain — and that is not a set anyone has reviewed.

The only reliable way to find out is to **break the thing the check exists to catch, confirm the break landed, and watch which assertions fire.** That move found something every time it was used, and twice it found that the check itself was disarmed.

The entries below are the individual cases, kept because the detail is where the argument lives.

## Generated code: two constraints that bind every service

**1. Integer width is never implicit.** A bare `{"type":"integer"}` in JSON Schema carries no width, and generators default to **int32** (~2.1bn). Our IDR and Points schemas permit **10,000,000,000 in the schema's declared unit** — already ~4.7× over int32, and ~470× over it if that unit becomes sen (see the open decision in `docs/16`). `FaceValueIdr int32` would have silently truncated a legitimate Rupiah amount in the first Go value-zone service, inside a file headed _DO NOT EDIT_. **The int64 requirement holds under either reading; only the magnitude of the overflow changes.** **Every integer exceeding int32 carries `format: "int64"`, and a test fails if one slips through.** Found in YT-0031 before any Go service existed.

**2. The OpenAPI document is permanently a weaker contract than the Zod schemas.** JSON Schema cannot express cross-field rules, so `.refine()` vanishes silently into the generated document, the Go types and any client. There are 12 such rules across 5 schemas — _settlementValueIdr cannot exceed faceValueIdr_, _expiringPoints cannot exceed availablePoints_, and so on. These are **economic invariants**, not cosmetic validation.

This is not fixable, so it is contained: each rule is declared as prose in the registry, emitted into the component description so it reaches generated Go as a doc comment, and a test asserts the declared count matches the actual refinement count — adding a `.refine()` without documenting it fails CI.

**The consequence for the stack:** any service enforcing a cross-field rule must **run Zod, or re-implement the rule and test it**. Generated types alone are not enough. This falls hardest on exactly the Go services in `docs/15` — ledger, pricing, voucher, redemption — because they hold the invariants that matter most. Budget for re-implementation with tests in each, and treat a Go service that trusts generated types for validation as a defect.

**3. Canonicalisation is one idea, pinned by a test.** Any value the platform hashes or signs across a language boundary — the idempotency fingerprint, the merchant HMAC request, the voucher QR payload — uses **one** canonical shape, and a test pins the **exact hex digest** rather than merely asserting the function is stable. These are wire contracts: a Go service computing the fingerprint differently from the TypeScript one makes a legitimate retry look like a mismatch, and a correct client is told to fix a correct request. Hash **raw bytes**, not canonical JSON — stricter than necessary, never wrong, and it sidesteps canonical-JSON, which is a notorious source of cross-language disagreement.

**Policies are the source of truth for what an action requires — not the ticket, and not the brief.** A screen must never offer an action the policy would refuse, and must never **fabricate a step the policy does not require**. Both are the same defect seen from opposite sides. This has already been caught once: a brief asked for a two-person-approval flow on the Team screen, and `policies/` has no such rule — dual approval is scoped to bulk voucher issuance, material settlement-value decreases and credential rotation, none of which are `team` actions. The implementation checked, found the brief wrong, stated the real position and pointed at where dual approval actually lives. **When a brief and a policy disagree, the policy wins and the brief gets fixed.**

**A fixture can describe a world that cannot exist; a database cannot.** Seeding the _same_ generators into real Postgres (YT-0519) immediately exposed that `generateVoucher` invented a `listingId`, a `merchantId` and a face value with **no relation to any listing** — because nothing in an in-process fixture requires them to agree. Inserted as-is they violated the foreign key. Had they somehow not, the result would have been worse: a voucher for listing L, issued by a different merchant, at a face value that listing never offered — **a state no real flow can reach, and the first person to debug against one loses a day.**

So a seed **derives** dependent records from the records actually inserted, and asserts the agreement. Beyond exercising the real path, seeding into a real schema **proves the fixtures were describing a reachable world in the first place** — which is a stronger guarantee than any fixture test can offer.

## A suite that silently skips is worse than one that fails

Until 2026-09-19, **no workflow ran a single Postgres-backed test.** `packages/db`, the Postgres idempotency store and the Go ledger all skip or fail without a database — so the deferred balance trigger, one-of-eight concurrent claims winning, and an unbalanced transfer refused at COMMIT were all **green in CI by never running**. Every one of those is a guarantee the plan rests on, and CI was reporting success for work it had not done.

**A failing suite tells you something is wrong. A skipping suite tells you nothing while looking like it told you something good.** So: every integration suite runs against real service containers in CI, and the workflow **fails the build if any test reports SKIP** — suites cannot quietly opt out of the thing they exist to prove.

The generalisation: **a test that cannot run in CI is documentation, not verification.** If a guarantee matters, the environment that proves it belongs in the pipeline, not on one developer's machine.

**Serialisation failures are worst when the database is emptiest — a fresh-database load test is harsher than production.** The ledger's balance trigger reads `ledger.entry WHERE transfer_id = …` at COMMIT, and under SERIALIZABLE that takes a **page-granular** SIRead predicate lock. While the table and its index are small, every transfer's read lands on the **same index page**, so each conflicts with every other despite touching entirely different transfers. Contention falls as the table grows.

Two consequences. **A developer meets this before an operator does**, and will reasonably conclude the design is broken when it is not. And **retry jitter matters more than the backoff growth**: without it every conflicting writer wakes at the same instant and collides again, turning contention into a thundering herd. Retrying is only safe because the transaction is idempotent end to end — which is the actual precondition, not the retry policy.

**The general class: a process that did less than it claims, reporting the same result as one that did everything.** A test suite that silently skips and a deletion that silently omits three of nine domains are the same defect wearing different clothes — and in both cases the honest implementation is _harder to write and reports worse news_. That is exactly why the tempting version wins by default.

**The rule: partial completion is a distinct outcome from success, and it names what was not done and who owes it.** Never a boolean where a report belongs. And distinguish **not implemented** from **failed** — they send different people looking.

**Never store a value you can derive — it is a second source of truth, and when the two disagree the derivation is right and the stored copy is the bug.** This has now decided three designs independently: `Balance` is a projection over entries rather than a column; a point purchase records **points allocated** and **cash received** as two facts with **no price-per-point column** between them; and where a duplicate is genuinely unavoidable — sqlc needs its own `db/schema.sql` copy — it carries a **drift test** that fails naming the exact columns.

The rule, in order of preference: **derive it; if you cannot, guard the copy with a drift test; never leave an unguarded duplicate.** The tell is that the stored version is always the one that looks like a convenience.

## Two agents, one working tree

Running two streams concurrently in a single checkout **cost a verification, not just time**. The frontend stream could not re-run the 320px and 200%-zoom suites because a partial `packages/contracts` change from the backend stream was live on disk: `tsc` failed on files the frontend had never touched, and a half-written `.next` from the failed build destroyed the good one from the successful build minutes earlier.

Note what the damage actually was. No code was lost and no wrong code shipped — what was lost was **the ability to prove something**, and it was lost silently: the failure surfaced as a type error in someone else's feature, which reads like a regression rather than like contention.

**The rule:** parallel streams may share a tree only while they share no build. The moment one owns a package the other compiles against — `packages/contracts` is exactly that package here — they need separate worktrees, or the second stream needs to be told to verify _before_ the first starts rather than after.

**The tell:** a build that succeeded and then failed with no diff of your own in between. That is never flakiness. Check `git status` on the packages you consume before you conclude anything about your own change.

**And the same rule applies to `git add -A`.** Committing a shared tree stages whatever another stream happens to have half-written, so the message describes one change and the commit contains several — including work that does not build yet. Stage your own paths. This was learned by doing it: a commit labelled as a one-file ticket carried a partial currency migration, and the honest repair is to amend the message to say so rather than to rewrite the history into something tidier than the truth.

## A seeded generator is idempotent only for a fixed contract

Adding one property to a schema changed **every id below it**. The mock generators draw from a seeded faker in field order, so an inserted field shifts every subsequent draw — every downstream uuid becomes a different uuid. `ON CONFLICT DO NOTHING` then conflicts with nothing and inserts a whole second catalogue: 30 listings became 60.

**That is not idempotency failing. It is idempotency working perfectly on data that is no longer the same data** — the keys really are new. Which is why it is dangerous: the mechanism is behaving correctly and the outcome is still wrong, so the instinct to go and debug the upsert leads nowhere.

The guarantee a seeded generator actually offers is **"idempotent for a fixed contract"**. After any contract change the supported path is a reset (`pnpm dev:fresh`), not a re-seed (`pnpm db:seed`).

A corollary about partially-working commands: `pnpm dev:fresh` had never worked — the seed read `process.env.DATABASE_URL` and pnpm does not load `.env`, so migrations applied and the seed then failed. **A documented command that completes two of its three steps is worse than one that does not exist**, because it leaves a half-built state that looks deliberate.

## Two constraints worth copying

Both came out of the ledger proof work and generalise:

- **Make the bad state unrepresentable rather than validated.** A voucher names a branch; a composite foreign key `(listing_id, location_id)` → `listing_location` means it cannot name a branch its own listing does not serve. A jsonb column would have matched the Zod shape more directly and bought nothing. The failure being prevented is a customer sent to a shop that has never heard of the offer.
- **Do not offer the degraded mode as a constructor option.** The invariant checker takes an `Alerter` as a required argument, so there is no way to build one that can only log — because the version that can only log is the version that ships. The placeholder is named `LoggingAlerter`, for what it is, and carries the warning: _a pager that cannot fail is a pager that cannot tell you it did not reach anyone._

## A `.example` file is an unguarded duplicate

`.env.example` had drifted **seven keys ahead** of the working `.env` on this machine, including every `S3_*` value, and nothing said so — the media origin was simply unreachable until someone looked. The example file is a second copy of a contract with no drift test, which is the same shape as the schema copy, the OpenAPI description and the backing rate duplicated in four files.

The asymmetry is what makes it bite: the example drifting _ahead_ produces a missing key and a confusing runtime failure, while drifting _behind_ produces nothing at all until a new machine is set up. **A startup check that names every key present in `.env.example` and absent from the environment costs almost nothing and converts both into one clear message.**

## Check what a gate's command actually covers, not what its name implies

`apps/web`'s lint script was `eslint app`. Every other package in the workspace lints `src`, which is where all of its code lives — but the web app keeps **68 files in `app/` and 486 in `features/`**. So `turbo run lint` reported green across the workspace while **87% of the web codebase had never been linted at all**, and eight real errors sat in it invisibly.

This is the fifth instance this week of the same shape, and by now it is the house failure mode rather than a run of bad luck:

| The gate               | What it actually did                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| CI guarantees          | Never ran a Postgres-backed test                                            |
| Two ledger proof tests | Skipped rather than failed                                                  |
| `openapi:go:check`     | Compared the generator's output to itself; nothing ever compiled the module |
| YT-0521 at `review`    | Carried the same criterion twice, ticked and unticked                       |
| `turbo run lint`       | Linted 68 files of 565                                                      |

Every one passed. Every one was believed to cover something it did not touch. **The question to ask at review is not “is the gate green” but “what set of files did this command actually read”** — and the cheapest way to answer it is to break something on purpose and watch the gate fail.

## `.ts` means two things, and three tools have now been bitten

HLS segments are MPEG **transport streams**, named `.ts` — the same extension TypeScript uses. Prettier parsed binary video as TypeScript and failed the format gate. `tsc` reported `File appears to be binary` on the same files. Both were fixed locally by the person who hit them, in different packages, without either knowing the other had.

**Any tool that globs `**/*.ts` will do this**, so the fix belongs at the fixture directory and applies to every such tool at once: exclude it in `.prettierignore`, in `tsconfig.json`, and in anything added later that walks the tree. The failure is loud but the diagnosis is not — "binary file" in a typecheck reads like a corrupt checkout, not like a naming collision.

The wider point is the one that cost the time: **two sessions hit the same root cause and each fixed it locally.** A fix applied where it was felt rather than where it originates is a fix the next person gets to discover again.

## A test can assert the bug

Every gate failure catalogued above shares one shape: the check did not cover what its name implied. **This one is worse.** A player spec asserted that seeking to the end completes a campaign — a passing, reviewed, committed test whose subject was a fraud hole, stated as the expected behaviour. It did not go green only because Chrome declines to set `ended` on a seek.

So the review question has to be asked in two directions, not one:

- **Does this gate actually run over the thing it names?** — the five failures tabulated above.
- **Is the thing it asserts the behaviour we want?** — this one.

A green suite answers neither by itself. **Tests written from the implementation inherit its bugs as requirements**, and the further a spec is from the rule it protects — an e2e player test is a long way from the attention-verification model — the easier that inheritance is to miss. Where a test touches something the threat model cares about, cite the rule in the test, so the next reader can check the assertion against the intent rather than against the code.

## A decision does not announce which code it just made wrong

Decision **O-1** was taken in the morning: the reward is all or nothing at completion. By the afternoon it turned out the shipped player had been built for the model O-1 supersedes — a live-growing **"Reward so far: X / total"** tally, chapters labelled **"earned"** with individual point figures, and two error boundaries telling users outright that _"anything you already earned was not lost"_.

All of it false under O-1, and **all of it at `review` with passing tests**, because the tests asserted the old model faithfully. Nothing went red. Nothing could have: the code was correct for the rules it was written against, and the rules changed underneath it.

This is the sharpest form of the pattern in this file. The earlier entries were checks that did not cover what they named, and one that asserted the wrong answer. **This one is code that was right when written and became wrong without moving.** It was found only because a brief happened to mention the new decision to somebody reading that area.

So a decision that supersedes a model is not finished when it is written down:

- **Name the artifacts it invalidates in the decision itself**, not only the rule it replaces. O-1 listed `docs/06` and YT-0124; it did not list the player, and the player was the part users would see.
- **Grep for the vocabulary of the old model** — here, `earned`, `so far`, `accrued`. Superseded models leave their words behind in UI copy and comments long after the logic changes.
- The worst instance is always in **user-facing copy**, because that is where a stale model becomes a promise. A user who watches twenty-eight minutes believing they have banked something, and receives nothing, has been misled by us rather than disappointed by a rule.

## Prove a wiring by breaking it, not by counting greens

`apps/api`'s six repositories were swapped from in-memory maps to Postgres and **96 tests went green**. That number is worthless on its own — it is exactly what the in-memory version produced the day before. So the database URL was pointed at a dead host and the suite re-run: **23 tests failed.** _That_ is the evidence the wiring works, and it took one command.

The general form: **when you replace an implementation, the passing suite cannot distinguish the new one from the old one.** Only a deliberate break can. This is the same move as the planted `stripe` import, the re-introduced Cerbos schema bug, the sabotaged manifest URL and the deliberately-wrong payment driver — five times now, and every one found something a green run could not have.

**And the break itself needs checking, which was learned the hard way one ticket later.** A dead-host sabotage of the watch suite came back **14/14 green**, and was nearly written up as proof the routes were wired. The cause: `vitest.config.ts` sets `env.DATABASE_URL`, and **that overrides a value passed on the command line** — the config quietly restored the working URL. The earlier YT-0552 proof had worked only by accident, because that helper reads `TEST_DATABASE_URL`, which the config does not set.

So the rule has a second half: **a deliberate break is evidence only if you confirm the break reached the code.** A green run after sabotage is indistinguishable from sabotage that missed — and the first reading of it is always the flattering one. The real proof here is that the suite now **fails to load and every test is skipped**, which is unambiguous in a way a pass never is.

Two things fell out of the same ticket that are worth generalising:

- **A guarded fallback is still the path every test takes.** The idempotency store's in-memory branch was blocked in production, so it looked handled — but while it existed, every test used it, and an `INSERT ... ON CONFLICT DO NOTHING` exercised only as a `Map` proves nothing about the statement that does the work. **Delete the fallback; do not guard it.**
- **"No constraints fired" deserves the same scrutiny as a failure.** The conversion was expected to be unpleasant and was not, and the reason was checked rather than assumed: the Drizzle schema already matched the migration column for column. So the honest claim is narrower than the ticket hoped — _the queries execute at all now_ — and the value arrives on the **next** schema change.

## Two tests over one area is often one test and a bystander

Ceiling rounding in the pricing engine was sabotaged to check the suite would catch it. The specific rounding test failed, as intended. **The margin-property test did not** — an 8-versus-6 spread absorbs a single point of rounding, so the property stayed true while the arithmetic was wrong.

Nothing in a green run would have revealed that. Two tests appeared to cover the pricing formula; in fact **one test was holding that decision and the other was a bystander**, and if the rounding test were ever deleted as redundant the property test would keep passing over broken arithmetic.

**Coverage tells you an area is tested. It does not tell you which test is load-bearing** — and those are different facts. The only way to learn the second is to break the behaviour and watch _which_ assertions fail. Where a rule matters, note in the test that it is the sole guard, so the next person deleting duplication knows which one is not duplicate.

This also refines the break-it rule: do not stop at _the suite went red_. Ask **how many** assertions fired, and whether the ones you expected to were among them.

## Smart App Control blocks test binaries, per binary, unpredictably

This machine has Smart App Control **enforced** (`VerifiedAndReputablePolicyState = 1`), with **105 CodeIntegrity events in 24 hours**. `go test` compiles fine and is then blocked from executing the test binary it just built — **per binary, and inconsistently**: `internal/code` ran and `internal/lifecycle` did not, from the same command.

That inconsistency is what makes it expensive. A uniform block reads as an environment problem within a minute; an intermittent one reads as a flaky test, and gets debugged as a code problem. **A failure whose message does not name its cause will be attributed to whatever was most recently changed.**

**Workaround:** run the Go suites in `golang:1.26`, matching how this repo already runs Atlas, sqlc and Cerbos. Smart App Control cannot be re-enabled once switched off without reinstalling Windows, so the container route is the reversible one and should stay the default even if the setting later changes.

## Stripping cannot fail open; rejecting can

A test asserted that a presented question carrying a smuggled `correctAnswer` would be **rejected**. It is not — Zod strips unknown keys by default. The assertion was changed rather than the schema, and the reasoning is the part worth keeping:

**A rejection throws while serving a response.** The tempting fix for a throw in a response path is a `catch` that returns the unparsed object — with the smuggled field still in it. So the strict version has a failure mode that ends with the secret being served, reached by an error handler somebody adds months later for unrelated reasons. Stripping has no such path: the field is gone before anything can go wrong.

The general rule: **at a boundary that protects a secret, prefer the control that degrades to safe over the one that degrades to an exception.** Strictness is the right instinct for input validation, where a throw means a request is refused. It is the wrong instinct on the way out, where a throw means somebody writes a fallback.

The same ticket has the better version of the guard itself: the answer-key test walks **all five question types against an exported field list** rather than two hand-picked names, so a sixth type with a new kind of key **fails** rather than passing unnoticed. A guard enumerated by hand only protects what its author remembered.

## A CHECK constraint that looks total is not, because NULL is not FALSE

The PII screening gate was written as:

```sql
CHECK (status <> 'approved' OR pii_screen = 'clear')
```

When `pii_screen` is NULL — a question **nobody has screened at all** — `pii_screen = 'clear'` is NULL, so the whole expression is `FALSE OR NULL` = NULL. **A Postgres CHECK passes on NULL; only an explicit FALSE fails it.**

So the constraint correctly refused `needs_review` and `rejected`, and cheerfully allowed the unscreened case — **the most common state, and the exact one the control exists for.** Rejecting two of three wrong values is why it read as correct in review.

**The general form: any `CHECK (a <> x OR b = y)` where `b` is nullable has this hole.** Three-valued logic means a constraint can look exhaustive over a column's values and be silent on its absence. Either add `b IS NOT NULL AND ...`, or make the column `NOT NULL` so the question cannot arise.

It was found by writing the **refusal** rather than the happy path — the sixth time that has turned something up. The happy-path test would have passed: a screened, approved question is allowed, which is true and proves nothing about the case that mattered.

## Migration versions are a shared resource with no allocator

Three version collisions in about fifteen minutes — on 14, 15 and 18 — because sequential small integers mean two sessions both reach for "the next number" and both are right. The file numbering carries no information about who is holding what.

**Convention: a migration version is a wall-clock stamp, `YYYYMMDDHHMMSS`.** Two sessions can then only collide by starting within the same second, and the ordering still reflects when the work happened. Rename unapplied migrations to match; **leave applied ones alone**, because renaming a migration Atlas has already hashed is worse than an ugly number.

## A correct narrowing is the cheapest way to find an unchecked operation

Splitting voucher writes onto their own role was right — voucher issuance is value-path, same reasoning as the ledger. Within an hour it had broken two things, and **neither was the split**:

- The shared seed inserted vouchers as the app role. Fixed by seeding as the **owner**, because seeding is administration and otherwise it breaks again the next time anyone adds a value-path role.
- **`anonymiseVouchers` re-owners a voucher to a tombstone**, and the app could no longer update that table. **A right-to-erasure request failed.** Fixed with `GRANT UPDATE (owner_id)` — the app may sever a subject from an instrument, but may not alter what the instrument is worth.

The second one is the point. **That operation had never been checked against the privilege it needed**, and nothing would have checked it: it ran as a role that could do everything, so it worked. Narrowing the role was the first thing that ever asked the question.

**A permission boundary is a test that runs in production.** Every operation crossing it gets asked, once, whether it has the authority it claims — which is why risk 45 (the app connecting as a superuser) is worse than it looks: it does not merely grant too much, it **suppresses that question for every operation at once**.

And the reason this surfaced as a red test rather than an unmet legal obligation is that the DSAR handlers were built to report `status: "failed"` and `complete: false` rather than claim success. **A handler that swallowed the permission error would have satisfied the suite and failed the user** — the same distinction as a checker that can only log.

## An idempotent operation that short-circuits never runs the path it is trusted for

While fixing the superuser problem, `pnpm db:seed` passed locally against the narrowed app role — and would have **failed on CI's fresh database**. The seed inserts vouchers, the app role no longer may, and the local run never found out **because the database was already seeded and the insert was a no-op**.

Idempotency is the property that made it safe to re-run and the property that hid the failure. **A second run of an idempotent job exercises the skip, not the work** — so a green local run says the guard worked, and says nothing about the operation behind it.

This is the same shape as risk 45 one level along: **green because the interesting path never ran.** It joins the guarded in-memory fallback that every test quietly selected, and the CI suite whose Postgres-backed tests all skipped.

**The check that costs nothing: run it against a fresh database before believing it.** `pnpm dev:fresh` rather than `pnpm db:seed`, and treat "it passed locally" for any idempotent job as unproven until it has run from empty.

## On a bearer instrument, the holder is not an attribute of the value

Anonymising a voucher needs to re-owner it to a tombstone. The coordinating session decided on `GRANT UPDATE (owner_id)`, reasoning that **the app may sever a subject from an instrument but may not alter what the instrument is worth**. That reasoning was wrong, and the implementing session refused it.

**A column grant permits any value in that column.** `SET owner_id = <tombstone>` and `SET owner_id = <attacker>` are the same statement with a different parameter. On a bearer instrument the holder **is** who receives the money, so the grant would have handed anyone holding the application credential the entire voucher float — while every value column stayed reassuringly untouched. It was a re-owning grant described as a severing grant, and it protected the number rather than the money.

**What landed instead:** `voucher.anonymise_owner(uuid)`, `SECURITY DEFINER`, with the tombstone **baked into the body as a constant rather than taken as a parameter** — so the app may perform the operation and cannot choose where the voucher lands. The app keeps no `UPDATE` on the table at all. Verified: app `UPDATE = f`, `EXECUTE = t`.

Three details in it that are the difference between this and a new hole:

- **Owned by `yourtal_voucher`, not the database owner.** A `SECURITY DEFINER` function owned by a superuser reintroduces risk 45 one layer down, wearing a function signature.
- **`search_path` pinned.** A definer function that resolves its own table names through the caller's path can be aimed at a different table by the caller.
- **It refuses the tombstone as a subject.** A no-op today; tomorrow an oracle reporting how many people had exercised erasure.

**The general rule: least privilege is about the set of reachable end states, not the set of touched columns.** Ask what an attacker holding this credential can cause to be true — not which fields they can write.

## Not every instance of a dangerous pattern is a bug

After the NULL-defeats-a-CHECK finding, a sweep pulled every CHECK containing `OR` and drove each at its NULL case rather than reasoning about it. All refused correctly — but one, `CHECK (approved_by IS NULL OR approved_by <> requested_by)`, **passes with a NULL approver deliberately**, because a requested-but-unapproved batch is a legitimate row.

What actually refuses an unapproved batch in a minting state is a companion constraint using `IS NOT NULL`. So **that constraint is only safe as a pair**, its first half reads exactly like the bug, and a later reader deleting the companion as redundant would open the hole. There is now a test asserting the pair, with the reasoning beside it.

Two things follow. **A pattern match is a reason to look, not a verdict** — the sweep was right and three of three were fine. And **where safety lives in a pair, say so in both halves**, because the danger is not the constraint being wrong but a future reader being correct that one of them is redundant.

## A test helper can disarm its own test

A `placeHold` helper generated a fresh `gen_random_uuid()` merchant per call. The duplicate-order index is on `(merchant_id, merchant_order_ref)`, so the two holds it compared **were never duplicates and the constraint was never asked.**

It was caught only because it failed **for the wrong reason** — expecting a rejection and receiving a uuid. Written to reuse a merchant by luck, it would have passed and covered nothing, and would have read as protection for a uniqueness rule that had never once been tested.

**The setup is part of the test.** A helper that makes each case independent is usually good practice and is precisely what defeats a test about collisions. When asserting that two things conflict, check that they were eligible to conflict.

## A benign bug can wear the costume of an attack

The voucher event chain hashed `UnixNano()`. Postgres `timestamptz` keeps **microseconds**. So the instant written and the instant read back were different numbers, and **every chain failed to verify on the way out** — presenting as _"the chain is broken at seq 1"_, which is precisely what tampering looks like.

It was a unit mismatch across a storage boundary: the same class as rupiah-versus-sen, one field over. The author had written a careful paragraph about jsonb normalising numbers and missed the identical argument about time.

Two things worth carrying. **No in-memory test could have found it** — the old test hashed values it kept in memory, so the round trip that broke it never happened. And **an integrity alarm firing does not mean integrity was attacked**; the first hypothesis for a hash mismatch should be that something normalised on the way through, because storage layers round, truncate and canonicalise constantly and attackers are rare.

## Narrowing a check to remove false positives can leave it checking nothing

A seed coherence check scanned every voucher in the table. That meant "every seeded voucher" right up until the voucher service began minting — and a minted voucher takes its terms from its approved batch rather than the listing's current columns, deliberately, because the terms of an issued voucher must not change when someone later edits the listing. So the check asserted a rule that did not apply to those rows and reported **107 violations that were not violations**.

The fix was to scope it to `batch_id IS NULL`. **The important half was also asserting the scope is not empty**, because a narrowed query that matches nothing passes — for the wrong reason, and silently, which is the exact failure that file exists to catch.

**Any time a filter is added to quieten a check, assert the filter still selects something.** The pressure to narrow arrives precisely when the check is inconvenient, which is when it is least examined.

## A parser-based gate fails open

A schema-drift guard extracted column names with `[a-z_]+`. A column containing a digit **does not match, and an unmatched column is not compared** — so the gate quietly stops covering it rather than failing. In one service this silently dropped `manifest_sha256` and then reported a drift that did not exist; in another the same pattern is fine **only because no column there happens to contain a digit.**

**Every parser-based check needs one question asked of it: what does it do with input it does not recognise?** If the answer is "skips it", the gate's coverage is whatever the pattern happens to match, and that is not a set anyone has reviewed. The fix is not a better pattern — it is **asserting the match count equals the input count**, so unrecognised input becomes a failure rather than an omission.

## The gate's own logic is often the least-tested code in the module

The schema-drift guard's parser had **no coverage in `go test ./...` at all.** The DB-backed guard calls `t.Skipf` without Postgres — correct for a unit run — so the parser, **which is where the defect actually lived**, was never exercised outside an integration environment.

**A check tends to be written as glue and tested only end to end**, so its own logic runs only when everything else is available. Then the one piece nobody unit-tests is the piece deciding whether everything else is correct.

Six parser tests that need no database now run wherever the module builds. And **an empty column list is now a failure**: a renamed table previously produced no expectation, and an empty expectation compares nothing and passes — the narrowed-query defect, one level up.
