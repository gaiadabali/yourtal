# Lessons, part 4 — what the first CI run taught

`docs/13c-lessons.md` reached its 300-line ceiling on the day this was written. It closes with ten gates that reported success while covering less than their names claimed, and with the review question that found them:

> **Not "is this green", nor even "is this asserting the right thing", but: what does this check do with the case it was not shown?**

On **2026-09-20** the repository got a git remote for the first time. Six GitHub Actions workflows that had been written, reviewed, committed, cited as mitigations in the risk register, and **never once executed** ran at last. Every one of them failed. Not one failure was a CI-environment quirk; each had been true in the repository for as long as the workflow existed.

This file is that day, because it is the largest single batch of the same pattern yet found, and because the mechanism was new: not a check that covered too little, but **a check that had never run at all**.

---

## 1. An unrun guarantee is worse than no guarantee

Risk 37 read, in the register, as closed: _"Fixed by `integration.yml` with real service containers and a build failure on any SKIP."_ That sentence describes a workflow which had never started. The register recorded the _writing_ of the mitigation as the _having_ of it.

No mitigation would have left the risk visibly open. A written one closed it — and closed it in the artefact the team uses to decide what to worry about next.

**Rule: a mitigation is a thing that has run.** Until it has, record it as proposed, and say where the evidence will come from.

## 2. Silence is indistinguishable from success

All six workflows trigger on `branches: [main]`. The branch was `master`.

Had the remote been added without noticing, every push would have produced exactly what a passing CI produces from a distance: no red. The failure mode of a misconfigured trigger is **nothing happening**, which looks identical to nothing being wrong.

This is the same shape as a skipped test reporting green, and as `t.Skipf` without Postgres — the family `docs/13c` documents. It is worth stating separately because the mechanism sits _outside the code entirely_, in a YAML field nobody reads twice.

**Rule: prove CI runs by making it fail first.** A pipeline whose first observed state is green has not been shown to run. Push a deliberate break, watch the red, fix it, watch the green.

## 3. A compensating control that shares a root cause is not a control

The best of the three failures.

`integration.yml` ran Cerbos as a `services:` container, mounting `policies/` and `infra/cerbos/config.yaml` from `${{ github.workspace }}`. GitHub creates service containers **before** the job's first step — before `actions/checkout` — so that directory is empty at mount time.

The author knew. The comment said so, and argued it was covered: `storage.disk.watchForChanges: true` would make Cerbos pick the policies up once checkout ran.

**That setting lives in `config.yaml`, which failed to mount for the identical reason.** The path did not exist, so Docker created a _directory_ at `/config/config.yaml`; Cerbos logged `Loading configuration from __default__` and `Found 0 executable policies`; the healthcheck then ran `--config=/config/config.yaml` against a directory and failed. **The mitigation was disabled by the fault it was mitigating.**

**Rule: when a control compensates for a fault, ask what the control depends on. If the answer includes anything the fault also touches, it is not a control.** This generalises risk 41's suspicion of simulators to every compensating mechanism.

A second lesson sits inside the first: **health is not readiness.** A PDP that starts with zero policies is _healthy_ and answers DENY to everything — it looks like a working authorization server while refusing every request. The wait step now asserts that policies loaded, not that the container is up.

## 4. Local green can be an artefact of a dirty working directory

`apps/web` linted clean here and produced **48 errors** on CI, all `no-unnecessary-type-assertion` on `as Route`.

The rule is type-aware. Next's `typedRoutes` generates `Route` into `.next/types`. This machine had `.next` lying around from earlier builds, so `Route` was the strict union and every cast was necessary. A clean checkout has never built, `Route` degrades to `string`, and all 48 casts read as no-ops.

`turbo.json` declared `lint: {}` — no build dependency — while `typecheck` declared `dependsOn: ["^build"]`. So a type-aware linter ran against types that existed or not depending on whose machine it was.

Confirmed by moving `.next/types` aside and reproducing **exactly 48**, the same count CI gave. Fixed with `next typegen` wired as a turbo dependency of `@yourtal/web`'s lint and typecheck. The casts were right; the environment was wrong.

**Rule: if a check consults generated artefacts, it must declare them as inputs.** Otherwise its result is a property of the machine, not of the code.

A footgun found while doing it: turbo's `package#task` syntax takes the **package name**, not the directory. `apps/web#typegen` matches nothing, applies no dependency, and emits **no error and no warning**.

## 5. Two commands over two file sets predict nothing about each other

CI ran `eslint apps packages`. Each package's own script was `eslint src`. Different file sets — so local green said nothing about CI, and CI's 72 errors were unreproducible locally: it was parsing the MPEG-TS media fixtures as TypeScript, which `eslint src` never reached.

Both were wrong in opposite directions. The narrow one missed files; the broad one linted video. CI now runs `turbo run lint`, the same command as local.

**Rule: the gate developers run and the gate that blocks a merge are the same command — or they are two gates, and only one of them is tested.**

## 6. The declaration and the bytes can disagree in silence

`.gitattributes` declared `* text=auto eol=lf`. Twenty-seven files sat on disk with CRLF. `git status` was clean throughout, and `git add --renormalize .` staged **zero files** — git compares content _after_ normalisation, so the index was already right and it saw nothing to do.

It surfaced as something else entirely: Atlas refused the migration directory with `20260920000011_idr_sen.sql was edited`. It had not been edited. `atlas.sum` was generated here from CRLF bytes; CI checks out LF. **Eleven** entries changed on re-hash, not one, because `atlas.sum` is a hash chain and a break at position 12 invalidates every entry after it.

**Rule: a declaration nobody checks is a comment.** `scripts/check-line-endings.mjs` now fails when on-disk endings disagree with the declared attribute — and it asks **git** for that attribute rather than keeping a second list that could drift from the first.

## 7. A cached pass is not a pass

Two instances on one day. `pnpm verify` answered green in **45ms**: `Cached: 11 cached, 11 total >>> FULL TURBO`. And `go test ./...` printed `ok (cached)` for a package whose invariant test **fails** when actually run.

Both are correct behaviour. Neither answers the question a gate is asked. A cache says "inputs unchanged since some earlier run" — and that earlier run may have happened without Postgres, on a different branch, or before the thing you are about to trust it for.

A third instance arrived the same day, from `yourtal-22`: `pnpm verify` reported **12 of 13 turbo tasks cached** on a branch about to be merged. Their response is the right one and is now house practice — **check the Go suites directly after every verify**, because `verify` reports a cached task and an executed one identically, and the distinction is the whole question.

**Rule: when a green result is about to authorise something — a promotion to `done`, a merge, a deploy — force the run.** `-count=1` is mandatory for Go in this repo for exactly this reason, and the flags are documented in the service manifests so whoever tidies next does not remove them as noise.

## 8. A cause is not a category — including one you just wrote down

Cerbos could not be a service container because service containers start
before `actions/checkout`. Moving MinIO into a step for the same reason
seemed obvious, and the commit said so in a comment: _"a service container IS
right here, unlike Cerbos: MinIO mounts nothing from the repository."_

That reasoning was correct and irrelevant. MinIO failed for an unrelated
cause: an Actions `services:` entry has **no `command` or `args` field at
all** — only image, env, ports, volumes, options and credentials — and
MinIO's entrypoint needs `server /data`. As a service it printed its usage
text and exited before the healthcheck.

The mistake is worth recording because of when it happened: **one commit
after writing §3 above**, which is about a compensating control that failed
because its author generalised from a cause instead of checking. Knowing the
pattern in the abstract did not prevent reproducing it within the hour.

**Rule: a diagnosis explains one failure. The next failure in the same area
gets its own diagnosis, even when — especially when — the previous one is
still fresh and fits.**

## 9. The family, named — four in one week, and the fourth was found by looking

`13c` listed ten gates that covered less than their names claimed. This week produced four more, and they are not ten separate lessons — they are **one shape in four places**:

| Where                                      | What made it fail open                                                |
| ------------------------------------------ | --------------------------------------------------------------------- |
| The ledger schema-drift regex (YT-0565)    | A column it could not parse became a column it did not check          |
| The app's Postgres connection (risk 45)    | Connecting as superuser made every `GRANT` decorative                 |
| `ResolveAuthorization` (risk 50 / YT-0571) | A query correct for its invariant, once the id became client-supplied |
| `set_settlement_value` (risk 51 / YT-0574) | An `EFFECT_ALLOW` whose guard is satisfied by an **absent** attribute |

The shared mechanism is not "fails open". It is that **each was correct for the case its author had in mind, and permissive for the case they did not**. The regex was right about columns it recognised. The query was right while only the domain called it. The policy was right when the attribute was supplied.

Two things make the last one the sharpest yet.

**The correct calling pattern is the one that disables it.** `attrsFrom` is `(request) => Record<string, unknown>` — synchronous, request-only, no database. Materiality compares against the _stored_ value. So a controller using the declarative decorator, which is the right and universal pattern everywhere else in this codebase, supplies nothing, and the control switches off. **A guard you disable by following the house style is worse than one you disable by mistake.**

**Two independent places agreed the omission was fine.** The policy expression accepted absence, and the resource schema listed only `businessId` as required. Neither is obviously wrong alone. Together they mean nothing in the system objects, and the redundancy that normally catches this instead confirmed it.

**The sharpest single fact of the four, and it belongs here rather than in a ticket:** `TwoPersonApprovalSuite` passes **28 of 28** against the control that absence switches off. It passes because every fixture supplies `isMaterialSettlementDecrease` directly — so **the absence case, which is the only case a real controller produces, is never exercised**. The suite for the control and the control's real-world failure mode **do not intersect at all**. A green suite was not weak evidence here; it was evidence about a different system.

**Rule: when a check reads an attribute, ask what it does when the attribute is not there — and check that the answer is written down in more than one place, because one of them will be a default.** In CEL specifically, `!has(x) || !x` reads as caution and means the opposite; `has(x) && !x` is the cautious form.

The fourth was the first found by _looking_ rather than by tripping over it: an agent wiring a controller asked what its policy would receive. That is the review question from `13c` used as a design question, and it cost minutes instead of an incident.

## 10. A gate added from an incident paid for itself the same day

`format:check` is second in `verify`. It exists only because the first CI run in this repository's history found **9 drifted files** under `format.yml` — a workflow that had been committed all along and had never executed.

Hours later the store module arrived from an agent that had run the tests and not the gate, carrying **8 files Prettier rejected**. `format:check` stopped the merge in about four seconds. That was **the first outside contribution it ever saw, and it caught it** (`14bd5a8`).

Worth recording for a reason beyond the tidy symmetry. The argument against a formatting gate is always that it is trivia. The 9 files were trivia; the 8 files were an **agent skipping the gate and running only the tests**, which is not trivia at all — it is the same class as a cached pass and a skipped suite, a check that did not run reported as work that was checked. **The formatting was the detector, not the defect.**

**Rule: when an incident produces a cheap gate, add it even if what it catches looks unimportant. What it catches is rarely the reason it is worth having.**

## 11. Two stale things agreeing is not a passing check

The sharpest one of the week, from `yourtal-22` (`428a0c6`).

`services/voucher/db/schema.sql` mirrors `store.listings` so sqlc can generate against it. The store migration added `lifecycle_state` and `per_user_limit`, and the mirror went stale. There **is** a drift test for exactly this. It passed.

It passed because that machine's dev database had never had the store migration applied either. **So the check compared a stale mirror against a stale database, found them identical, and reported success — for precisely the condition it exists to detect.**

This is a new member of the family rather than another instance. The others were checks that **did not run**: a cache answered, a suite skipped, a path filter never fired. This one **ran**, executed its comparison honestly, and was correct about the two things it was shown. Both were wrong in the same direction.

**Rule: a differential check needs its reference proven current, separately from the comparison.** Ask what makes the _baseline_ trustworthy — a migration count, a schema version, a checksum of the source of truth — because "they match" is a statement about agreement, not about correctness. It was caught in CI, where the database is built from migrations every run and therefore cannot be stale.

## 12. `ok` and `ok (everything skipped)` look identical

Also `yourtal-22`, and nearly recorded as a verification. They ran the drift test against a scratch database and got `ok`. Docker had died moments earlier; `schema_test.go` calls `t.Skipf("no local Postgres")` on a failed ping, and **`go test` prints `ok` for a package whose every test skipped.** They caught it only by chasing why an unrelated docker command had failed.

The existing mitigation — `integration.yml` failing the build on any SKIP — is real and it works. **But it only protects CI.** A developer running a Go suite locally with containers down gets a green wall and no signal at all, which is the same shape as §7's cached pass: the two outcomes are indistinguishable at a glance, and the indistinguishable one is the default.

**Rule: an explicitly-supplied unreachable dependency is a misconfiguration, not an absent optional one.** A helper that skips when `DATABASE_URL` was _not_ set is being helpful; a helper that skips when `DATABASE_URL` _was_ set and could not be reached is hiding a broken environment. The two cases deserve opposite behaviour, and locally only the second one is ever what happened.

## 13. `git add -A` in a shared working tree is a cross-session hazard

Two sessions work in this one checkout. On 2026-09-20 a `git add -A` intended to stage one workflow file also swept up `policies/_schemas/resource/listing.json` — another session's uncommitted work-in-progress — into a commit whose message was about Actions spend.

It was harmless **only** because that change happened to be one the other session wanted committed and believed correct. That is luck, not process. The next collision is a half-finished edit landing in someone else's commit under someone else's reasoning, where the commit message actively misdescribes what shipped.

**Rule: in a shared working tree, stage paths, not everything.** `git add <path>` is a statement about what you changed; `git add -A` is a statement about what the _directory_ contains, and in a shared tree those are different claims. This is the fourth time this class has bitten here, and the first where the sweeping session did not notice at all.

## 14. A control added to a shared definition is not scoped to what motivated it

`isMaterialSettlementDecrease` was made `required` to close an absence-case hole on `set_settlement_value`. Cerbos validates the resource schema **before** evaluating policy, and `required` applies to the resource **kind**, not to an action — so `approve_settlement_decrease`, which has no business carrying a materiality flag, was refused before any rule ran. Integration went red on three consecutive commits.

Two sub-findings, each its own shape:

**A long-running container is not equivalent to a fresh one.** It passed locally because the Cerbos sidecar was serving schemas cached from before the change; CI starts clean. `docker restart` belongs in the verification of a policy change, not after it. Same family as a cached turbo task and a cached `go test` — a stale answer that is indistinguishable from a computed one.

**The suite could not have caught it.** `policy-test.mjs` runs an ephemeral Cerbos over fixtures, and every fixture for the _other_ actions predates the attribute, so none exercised them against the tightened schema. **It tested the rule that changed, not the resource kind it changed on.**

**Rule: when tightening a shared definition, enumerate every consumer of the definition, not every caller of the thing you were fixing.** The blast radius of a schema is the kind; the blast radius of a rule is the action. They are not the same set, and the narrower one is the one you are thinking about.

### 14a. The same mistake at the next altitude down — and this section had already named it

**2026-09-21, the second instance, introduced by the fix for the same ticket.** The rule above was written after the `required` schema change refused `approve_settlement_decrease`. Its closing sentence says _the blast radius of a rule is the action_. The next change to that policy put a condition on a **rule covering four actions**, and three of them broke.

`merchandisers-run-inventory` granted `create`, `edit`, `archive` and `set_settlement_value` under one `EFFECT_ALLOW`. YT-0574's fix added `has(R.attr.isMaterialSettlementDecrease) && !R.attr.isMaterialSettlementDecrease` — correct for the action that motivated it, and **fatal to the other three**, because only `set_settlement_value` has a route that can supply the attribute: it does a second authorization _after_ loading the listing, since materiality compares against the stored `S`. `create`, `edit` and `archive` are wired with `@Authorize` alone, which is synchronous and request-only and supplies no attributes at all. So `has(...)` was false and the ALLOW never fired.

Isolated against a freshly restarted sidecar, one variable:

```
attribute ABSENT        create DENY   edit DENY   archive DENY   set_settlement_value DENY
attribute PRESENT+false create ALLOW  edit ALLOW  archive ALLOW  set_settlement_value ALLOW
```

**A fix for a bypass produced a lockout.** Fixed by splitting the rule — ordinary inventory work with no condition, `set_settlement_value` on its own rule where the expression cannot reach anything else.

**The guardian was green on both sides of the defect, and its own description named the cause.** The suite read 390/390 before the repair and 390/390 after. The YT-0574 case used the right fixture — `listing_kopi_unstated`, attribute deliberately absent — and asserted `set_settlement_value` **alone**, varying the _principal_ across three business roles. Its description reads: _"Every business role that could otherwise apply a listing edit is checked here … because the bug was in the shared condition, not in a per-role rule."_ It correctly identified that the condition was shared, then tested the axis the **previous** bug had moved along.

**Rule: a guardian must assert every action on the definition it guards, not the action the bug was found in.** Extending that case to four actions × three roles took the suite to 399/399, and reverting the split produced 6 failures naming `create` and `edit` — so the guardian is proved, not assumed.

**What makes this worth a section rather than a line.** Five instances of this family now, and **two of them were introduced while fixing the ticket that documents it**: the kind-wide schema and the rule-wide condition. Written guidance did not prevent the second, because the guidance was read as being about schemas — the altitude of the first instance — rather than about _shared definitions_. The generalisation that does the work is not "be careful with schemas" but:

**The blast radius of an authorization fix is the definition it is written on, never the case that prompted it.** Before adding a condition, enumerate the actions on that rule. Before tightening a schema, enumerate the actions on that kind. If the set is larger than one, the fix belongs on a narrower definition.

## 15. The most dangerous false green came from prose, not from a check

Every other entry in this file is a mechanism that reported success: a cache, a skip, a regex, a guard satisfied by absence. This one was a sentence.

Closing a status report, I wrote _"everything already pushed is green and the app is live."_ The second half was verified. The first had been false for three consecutive commits, and I had not looked. `yourtal-22` caught it.

**The shape is different from a bad check and worse.** A check that covers too little was at least written as a claim; someone decided what it should assert. This was **throat-clearing that happened to contain an assertion** — nothing in the writing of it felt like making one. There was no moment at which a claim was being evaluated, so there was no moment at which it could feel unverified.

That is why it is worth its own entry rather than a footnote to §7. The others are caught by asking "what does this check do with the case it was not shown?". This one is not caught by that question at all, because there is no check. It is caught only by noticing that a summary sentence is a claim.

**Rule: a status line is a claim, and gets the same bar as an assertion in code.** If a report says green, someone looked at green — recently, on this commit, not at a run they remember. "Everything is fine" is the easiest sentence to write and the only one nobody re-reads.

Worse from the session whose stated job is verifying other sessions' claims, which is the other half of why it is recorded here under its author's name rather than in a commit message nobody will open again.

## 16. A fix that was not pushed is not a fix, and "HEAD" is ambiguous

The repository was public for a few hours. I scrubbed the infrastructure identifiers, committed, and reported the exposure closed at the tip with history still outstanding. Both halves of that sentence were wrong in the same direction.

**It was never pushed.** It sat behind the Actions-spend freeze as one of eight local commits while `origin/main` — the thing that was actually world-readable — went on serving the real values. I wrote "scrubbing HEAD", meaning _my_ HEAD, and read it back as though it meant the published state. Nothing in the phrasing flagged the difference.

**And the framing was wrong even if it had shipped.** I presented history as a residual risk behind a fixed tip. With two earlier commits carrying the values, the tip was never the exposure; it was the least of it.

What closed it was the founder flipping visibility back to private. Not my commit.

**Rule: when the risk is what other people can see, the only state that counts is the published one.** `git log` answers a different question from `git log origin/main`, and under a push freeze those diverge silently and without limit. Ask what the remote serves, not what the working copy says.

This is §15's shape in a new place. There the false claim was prose; here it was a real commit that really did what it said — to a branch nobody could read.

## 17. When a break-it proof does not break, find out why before concluding the control is sound

`yourtal-24` proved new campaign tests by breaking them, and the first two sabotages **failed to land**. Adding `draft` to `VISIBLE_STATES` left the suite green. Making `publicStatusOf` return `active` for a draft left it green too. Only breaking **both** turned three tests red.

A non-public campaign is hidden by **two independent controls that mask each other**: the repository filters `draft` in SQL, so the mapping never sees one; and the mapping returns `undefined`, so the row drops even if the SQL passes it. Each makes the other unprovable.

**That is good design with a trap inside it.** A future change removing one belt leaves the suite green while halving the protection — and the suite will go on being green for exactly as long as the second belt holds.

This completes a pair with §14. There, **two fixes landed in one commit and one masked the other**, so the tests verified the pair rather than the parts. Here, **two controls that predate each other mutually mask**, so a sabotage that fails to land is evidence about the system rather than about the sabotage.

**Rule: a sabotage that does not break the test is a finding, not a failed attempt.** The instinct is to assume the sabotage was wrong and try a different one; the discipline is to ask what else is holding the line. `yourtal-24` found this only by refusing that instinct twice.

`yourtal-22` drew the sharper operational consequence when relaying it to their voucher agent: **a masked tenant predicate fails toward a leak that looks fixed**, which is worse than this one, where both belts fail toward safety.

## 18. A writer that preserves what it finds defeats a declaration

`.gitattributes` declares these files `eol=lf`. Two sessions hit `check:eol` failures on files in this cluster, and the propagator was mine: a dozen ad-hoc edit scripts all carrying `const nl = raw.includes("
") ? "
" : "
"`, preserving whatever endings they found.

Preserving is the right default when the correct ending is **unknown**. It is the wrong default when the correct ending is **declared** — one CRLF write upstream and every subsequent regeneration faithfully keeps it, including `scripts/tasks.mjs`, which regenerates `TASKS.md` before every commit.

Fixed at the one committed writer: `tasks.mjs` now normalises on read, so it **heals** CRLF rather than propagating it. Sabotage-proved — forced `TASKS.md` to CRLF, guard caught 304, regenerated, guard clean.

**Rule: where an attribute declares the correct form, a writer normalises to it rather than inheriting it.** Inheriting makes every writer a carrier.

---

## 19. Three checks in one day, each narrower than the claim resting on it

`yourtal-24` put these together, and the grouping is worth more than any one of them. All three were **real greens answering a smaller question than the one being asked**, and in every case the narrowness was invisible from inside the check.

| Check                                       | Scoped by   | Claim it was used to support      |
| ------------------------------------------- | ----------- | --------------------------------- |
| `git grep` over two changed files           | **file**    | that a whole ref was clean        |
| A redaction table of four known values      | **pattern** | that all identifiers were removed |
| `git grep <pattern> <ref>` across every ref | **ref tip** | that **history** was clean        |

The third is the sharpest because it was an _acceptance criterion_ — the thing standing between a history rewrite and a force-push. It reported **"clean across 5 refs"** and **would have reported exactly that before the rewrite ran**, since `main`'s tip was already scrubbed. Measured properly by walking `git rev-list --all`: **99 commits carried an identifier before the rewrite, 0 after.** The tip-scoped check returned 0 for both.

The second is mine. My replacement map held four address literals and one hostname, so it redacted addresses and missed **every host name** — `<wg-hub>` and `<decommissioned-jump>` survived a scrub whose banner asserted the file was clean. A redaction list built from one kind of identifier misses every other kind, and `<jump-host>` had to be found separately, which is what proved the table was never a survey.

**Rule: state the claim, then ask what the check would return if the claim were false.** Every one of these three returns the same value either way. That question is cheap, it is answerable before running anything, and it is the one none of us asked.

**Corollary, and the half that keeps getting skipped: show the check failing.** `yourtal-24` ran the scan against the pre-rewrite state and watched it return non-zero — which is the only thing that distinguishes a check that passed from a check that cannot fail. They caught it because an empty diff surprised them and they asked why instead of accepting it.

---

---

### 19a. A fourth, and the first where two harmless things combined

**2026-09-21.** Checking whether the catalogue's full-text search had a GIN index:

```
grep -rn "to_tsvector\|gin\|GIN" packages/db/migrations/*.sql | head
```

Every line returned was a `bigint` column declaration, because **`bigint` contains `gin`** — and `head` cut the output before the real hits. One step from reporting _"no GIN index, the FTS is a sequential scan"_: plausible, alarming, and false. `listings_search_idx` exists and matches the query expression exactly. Caught by listing the indexes directly instead of grepping for them.

**Neither ingredient is dangerous alone.** A substring match is recognisable when you can see all of it; a truncation is harmless when the pattern is precise. The failure needs both — an imprecise pattern **and** a cut-off that hides how imprecise it was. Same family as the `grep -v "\.test\.ts"` that produced _"imported by nothing"_ on a symbol two test files import, and as a duplicate-ID sweep whose one hit was the worked example in `_schema.md`.

**Rule stays the same and gains a second clause: state the conclusion at the width of the search, and never let `head` decide the width.** If the output is truncated, the search has not answered the question yet — it has answered a prefix of it.

---

## 20. An assertion phrased as the absence of a failure passes on every other failure

A boot test was added over the eight listing routes after the `create`/`edit`/`archive` outage of §14a, precisely because the store module could not have seen it — its PDP-backed tests call controller methods directly, so `PdpGuard` never runs, and the decorator was the broken part.

The first draft asserted, for a merchandiser:

```ts
expect(response.statusCode).not.toBe(403);
```

All eight passed. **They were passing on 404s.** The URLs had been written as `/api/:tenantId/listings`, missing the `store` segment, so not one route existed. `not.toBe(403)` is satisfied by a route that is not there, by a 500, by a 400 — by everything except the one failure it names. **The suite's green was evidence of the opposite of its claim.**

It was caught only because the same suite had a deny half asserting a **stranger gets 403**, which failed with 404 and exposed the missing segment. A stranger receiving 403 can only happen if the route exists **and** the guard ran, so the negative case turned out to be the only thing pinning the positive one.

**This is not the guard-never-seen-red family.** The guard ran. It proved something else. The shape is the assertion's polarity: `not.toBe(x)`, `not.toThrow()`, `toBeDefined()` on a value with a default — each is satisfied by an unbounded set of states, most of which are broken.

**Rule: never assert only the absence of a specific failure. Pair it with a positive case that cannot hold unless the subject exists.** "Does not return 403" is not a claim about a route; "a stranger gets 403 here" is, because it fails when the route is missing. The paired case is the one doing the work, and if you only write one, write that one.

## The pattern, restated

`docs/13c` asked what a check does with the case it was not shown. Today adds the question that comes _before_ it:

> **Has this check ever run — on this code, in this environment, without a cache answering for it?**

Almost everything found on 2026-09-20 was invisible to every form of reading: the file, the assertion, the config, the risk register. Each became visible the moment something executed for real.

The cheapest way to learn whether a guarantee holds is unchanged from `13c`: break what it is meant to catch, and confirm the break reached the code. The addition is that you must first confirm **there is code for it to reach**.
