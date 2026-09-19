# 13c · Lessons the hard way

Split out of [`13-engineering-standards.md`](13-engineering-standards.md) on 2026-09-20 when it crossed the 300-line ceiling. Those are the **standards** — what to do. These are the **incidents** — what went wrong, and the rule each one bought. Every entry here was paid for.

**The theme, stated once so the individual entries read as a pattern rather than a run of bad luck:** almost every failure below was a _check that was believed to cover something it did not touch_ — and the last one is a check that covered the right thing and asserted the wrong answer.

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
