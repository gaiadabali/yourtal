# Task format

The task files in this folder are **the single source of truth for project status**. `TASKS.md` at the repo root is _generated_ from them and must never be edited by hand.

```
node scripts/tasks.mjs           # validate + regenerate the dashboard
node scripts/tasks.mjs --check   # validate + fail if stale  (CI gate)
```

## One task

```markdown
### YT-0042 · Ledger: double-entry transfer API
`todo` · P0 · value · 5d · dep: YT-0031, YT-0033

- [ ] `transfer()` writes ≥2 entries summing to zero, in one transaction
- [ ] `idempotency_key` is UNIQUE; a replay returns the original transfer
- [ ] invariant checker job fails loudly on any imbalance
```

| Field        | Rule                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| **ID**       | `YT-####`, globally unique, **never reused or renumbered**. Take the next free number. |
| **Title**    | `Area: what it does`. One line.                                                        |
| **Status**   | `todo` · `doing` · `review` · `blocked` · `done` · `cut`                               |
| **Phase**    | `P-1` · `P0` · `P1` · `P2` · `P3`                                                      |
| **Epic**     | lowercase slug — see below                                                             |
| **Estimate** | `3d` or `6h`. Ideal engineering time, one person.                                      |
| **dep:**     | comma-separated task IDs, or `—`. Validated; cycles are rejected.                      |
| **AC**       | at least one `- [ ]` line. Testable, not aspirational.                                 |

## Epics

`pilot` · `legal` · `infra` · `platform` · `value` · `economy` · `adplatform` · `media` · `watch` · `store` · `commerce` · `merchant` · `risk` · `web` · `data` · `seo`

## The status lifecycle

`todo` → `doing` → `review` → `done`. The two middle states are the ones that
get abused, so they are defined here and enforced by the validator.

| Status | Means | Bar |
| --- | --- | --- |
| `todo` | Not started | — |
| `doing` | Started, criteria not all met | — |
| `review` | **Work finished.** Every criterion met. Only independent verification is outstanding | all AC ticked |
| `done` | A session **other than the one that did the work** has verified it | all AC ticked + a verifier |
| `blocked` | Waiting on something **outside** the task graph | see rule 2 |
| `cut` | Dropped. Stays in the file | — |

**Why `review` is constrained.** On 2026-09-20 the board held **84 tasks in
`review` and 0 in `done`** — and **43 of the 84 had unticked criteria**, five of
them at 0 of n, under a dashboard column headed _"work complete"_. `review` had
no rule, so it became the place tasks went to stop being counted, and the
project's headline figure read 0%. A status that constrains nothing cannot be
read as a claim about anything.

**`review` → `done` needs a second pair of eyes.** The author ticking their own
boxes is the claim; it is not the verification. This is not ceremony — every
gate failure recorded in `docs/13c` was found by someone other than the author,
and none were visible from reading the assertion.

## Criteria vs. deferrals

`- [ ]` is **a criterion this ticket must meet to be finished**. Nothing else.

Use `- ⏭️` — no checkbox — for **work that belongs to another ticket**. It is a note, not a bar.

**Why this exists.** Both were being written as `- [ ]`, and the validator requires every box ticked before a task may reach `review`. A ticket carrying a deferral note is therefore **permanently short of its own bar and can never be completed**, however finished it is. YT-0101 is the clearest case: both its remaining boxes defer to YT-0102 and YT-0124, so as written it could never leave `doing`. Found by `yourtal-24` on 2026-09-20 — **the rule was creating the trap.**

The test: *if this ticket were otherwise perfect, would this line still be unticked?* If yes, it is not a criterion.

### Bullet forms

Only `- [ ]` / `- [x]` is a **bar**. Every other form is a **note**: it carries information and the validator does not count it.

| form | uses (2026-09-21) | means |
| --- | --- | --- |
| `- [ ]` `- [x]` | 1,068 | **a criterion** — a bar this ticket must meet |
| `- ⚠️` | 88 | a finding or caution — **not a bar** |
| `- ⏭️` | 21 | **deferred** — another ticket owns this work |
| `- ⛔` | 16 | a blocker note — **not a bar** |
| `- ✅` | 7 | resolved, with what resolved it — **not a bar** |
| `- ℹ️` | 4 | context a reader needs and no one must act on |
| `- ✏️` | 2 | this ticket's own text was corrected, and how |
| `- ❌` | 1 | **failed independent verification**, returned from `review` |
| `- 🚫` | 0 — new | **retired**: cancelled by a decision, nobody will ever do it |

**These were documented, not invented.** Eight of the nine were already in use — 139 bullets in forms this file had never defined, which describes the format drifting from its own documentation rather than 139 defects. Counted three times by three sessions within an hour at 19.8%, 20.0% and 20.7% of all bullets: **the proportion is stable and the absolutes are not**, so a count of this board is stale within tens of minutes. Cite proportions here, timestamp absolutes.

**`🚫` is the only new one, and `⏭️` could not cover it.** `⏭️` says *someone else will do this*; `🚫` says *nobody ever will*. YT-0124's two retired criteria are the case: decision O-1 makes the reward a single grant at completion, so "reward accrues per checkpoint" is not deferred to anyone, it is dead. **Do not reuse `- ❌` for this** — its one use means *failed verification*, a status note, and overloading it would blur the single distinction this table exists to draw.

**A struck-through criterion is the shape to avoid.** `- [ ] ~~dead text~~` is a criterion its own author has declared dead while leaving it blocking, so the ticket can never reach its bar. Write `- 🚫` instead. The validator rejects the old shape; see rule 8.

### Two rules for writing a criterion

1. **A criterion states a bar the ticket must meet; an argument for why the ticket exists is a note.** YT-0546's *"this is the part with near-term value"* and YT-0016's *"this is the one position the register rates Low confidence"* are both arguments for priority — nothing can implement them. **This stays a rule for readers and is deliberately not validated**: YT-0016's neighbour, *"settled before the first merchandise order, not after"*, reads like the same shape and is a real bar, because it is checkable at any moment and failing it is a state the ticket can be in. No scan can draw that line; the epic owner can.
2. **A criterion that names a mechanism ages badly; a criterion that names a property does not.** YT-0121 said *"nonce burned in Redis"* — and the `redis` service runs Valkey with `--save "" --appendonly no`, so it keeps nothing across a restart and every unexpired spent token becomes replayable at once. The implementation had already, correctly, used Postgres instead: **the criterion named a mechanism and then pointed away from the right answer while staying perfectly tickable.** YT-0553's *"point `DATABASE_URL` at a dead host"* is the same shape, made wrong by `TEST_DATABASE_URL`. Write the property — *"a spent nonce cannot be spent again, across a restart"*.

**A deferral inherits its description from the ticket that deferred it, and that description is exactly as old as the deferral.** So a `- ⏭️` may name the work and the owning ticket; it may **not** assert the current state of the code. YT-0583 was filed as three days of migration on the strength of YT-0502's own breaking-change note, written before the consuming side was migrated — two thirds of it was already done. The deferring ticket reads as authoritative and is not.

**When a defect touches two tickets, it belongs to one and the other gets a pointer.** A defect recorded twice is a defect that can be fixed once and still look open — and, worse, one that can be *closed* once while the second copy quietly goes stale. That is the shape that produced the `/au` 404 row in `TASKS.md`: one claim, two homes, only one of them ever checked. The worked case is 2026-09-21's `lang="id-ID"` defect, which touched YT-0181 (internationalised routing, where it lives) and YT-0180 (whose "indexable" criterion it arguably undermines). YT-0180 kept its tick and gained an `- ℹ️` pointing a verifier at YT-0181 before promoting it to `done`. Proposed by `yourtal-54` after the ruling went against them, which is the reason it is worth keeping.

### Regenerating the dashboard while other sessions are writing

`scripts/tasks.mjs` reads **every** file in this directory and bakes their combined state into `TASKS.md`. It writes only `TASKS.md` — no task file is ever modified — so the risk is not clobbering. The risk is **publishing a half-written board**: a partly-edited ticket is almost always still well-formed, so it validates green and the dashboard silently asserts a state nobody intended.

So the protocol has **two** halves, and only the first was obvious:

1. **The recorder announces before regenerating**, and anyone mid-write says wait.
2. **A writer announces when its batch is finished**, not only that one is starting.

**Why the second half exists.** On 2026-09-21 the recorder regenerated without waiting for a signal, while `yourtal-c8` was mid-batch in `phase-u-ui.md`. Nothing was published wrong — but only because c8's last edit landed at 14:06:47 and the regeneration ran at 14:11:57. **Five minutes of luck.** Ninety seconds earlier would have caught three of five blocks rewritten, validating green, publishing one ticket at `review` while another still carried a description its own work had invalidated — and **neither session would have had any signal it happened.** The fix is not more discipline; being mid-batch and being mid-sequence are both normal. It is that a promise to announce the start of a write says nothing about its end.

## Rules

1. **A task is `done` or `review` only when every AC box is ticked.** The validator enforces both.
2. **`blocked` means blocked by something outside the task graph** (a decision, a vendor, a licence). Waiting on another task is not blocked — that is `dep:`, and the dashboard works it out.
3. **No task larger than 5 days.** If it is bigger, split it. Large tasks hide risk.
4. **Every task names its acceptance criteria before work starts.** No AC, no start.
5. **Never renumber.** `cut` tasks stay in the file with `cut` status so history stays readable.
6. Regenerate the dashboard in the same commit as any task change. CI fails otherwise.
7. **Commit `scripts/tasks.mjs` in the same commit as any dashboard whose format it changes.**
8. **A criterion may not be struck through and left blocking.** `- [ ] ~~dead text~~` is rejected — use `- 🚫`. Enforced, and **proved in both directions**: a deliberate struck box makes the validator name the file, line and task id, and removing it returns it to green. Added 2026-09-21, after the first version of this guard was written with a corrupted regex (`/^s*- [ ]s*~~/`, backslashes lost in transit) that read correctly and could never match — green on a board that already satisfied it, and still green against deliberate sabotage. **A guard first seen passing has not been shown to work**; this one was only trusted after it was seen failing.
9. **No commit lands without `pnpm verify` green.** A session that cannot run it says so in its commit message rather than assuming; "my package's tests pass" is not the gate. Founder decision 2026-09-21.

10. **A cross-reference to an existing ID is not a valid cross-reference.** The validator proves every `YT-####` is unique and that every `dep:` resolves. **It says nothing about whether a pointer in prose points at what its sentence claims.** Deliberately not automated — the general case needs a reader, and a weak check here would be worse than none, because it would license trusting it.

11. **In a shared checkout, `git commit` consumes an index you did not build — and a private index hands the next committer a loaded gun unless you resync in the same breath.** Five sessions share one working tree. Staging the right paths does not protect you, because your entries are *added to* whatever is already staged.

    The complete form, and the last clause is the one that was learned expensively:

    ```sh
    export GIT_INDEX_FILE=$(mktemp)
    git read-tree HEAD
    git add -- <paths>
    git commit -F msg
    unset GIT_INDEX_FILE
    git read-tree HEAD          # RESYNC THE SHARED INDEX, immediately
    ```

    **Without that last line the shared index still describes the tree before your commit — and an index that does not know about a file present in `HEAD` does not leave it alone, it DELETES it.** The next session's commit silently reverts your additions, in a commit whose author cannot see it happening.

    **Five rungs, each the fix for the one before, all on 2026-09-21:**

    | | attempt | how it failed |
    | --- | --- | --- |
    | 1 | `git add <shared file>` | swept another session's edits into the commit |
    | 2 | `git status --porcelain` first | said which paths moved, not what they said |
    | 3 | `git add <explicit paths>` then `git commit` | right arguments, wrong mechanism — commit takes the whole index |
    | 4 | `git commit -- <paths>` | never consults the shared index, but **cannot stage an untracked file**, which is where new work lives |
    | 5 | private `GIT_INDEX_FILE` | closes both — and without the resync, **reverts the next session's work** |

    **Rung 5 produced a strictly worse failure than the one it fixed.** Rung 1 misattributed work into someone else's commit; rung 5 deleted it. `a7a70e2` removed 607 lines across seven files that its author never staged and could not see, and it was restored from the working tree in `6c903b9` — nothing was lost, because nothing had left the disk.

    **Two checkable tells, worth more than the rule:**

    - **A path that is both `??` untracked and present in `HEAD` means the index is stale**, and the next commit from it will delete something.
    - **The index can be staged to delete a file that exists on disk AND in `HEAD`.** `git status` does not show this at all — only `git diff --cached` does. Found by `yourtal-6c` with `.githooks/pre-commit` in exactly that state, so every working copy showed a guard that the next commit would have removed.
    - And the mirror: **read the numstat, not the names.** During the restore, `git diff --cached` listed exactly the intended paths while `--numstat` showed pure deletion.

    **Lead with this if it goes anywhere else:** a private index *sounds like* the correct engineering answer to a shared checkout, which is exactly why the next person will reach for it. Retracted and restated by `yourtal-4d`, who proposed it and whose own work it deleted.

    **The instance is the bad case rather than the easy one.** `yourtal-08` renumbered off a duplicate id on 2026-09-21 and left one cross-reference reading *"Now **YT-0595**"*. A dangling `YT-9999` dies at the first reader; this validated green and read as correct, because YT-0595 was **plausible and briefly true** — it named 08's own unsaved draft. **Nothing changed in the pointer; the world changed underneath it.** Found by grepping their own pointers rather than trusting the green.

    Same family as the day's other findings, and the family is worth naming: **the tree is not the commit; the index is not the arguments you typed; a scan for free IDs includes your own drafts.** In each, a check was green about a state that had already stopped being the one that mattered.

**Why rule 9 exists.** The 2026-09-21 coordinated landing was sequenced specifically to avoid red commits, and **all three source commits broke a different gate anyway**: `7f3317c` left two `as` assertions in `packages/contracts`, which bans them outright; `5eeb9ac` left two `exactOptionalPropertyTypes` errors in `store-listing.routes.boot.test.ts`; `7508a56` landed alongside seven unformatted committed files and seven with CRLF drift that stopped `check:eol` at gate 1. Each session verified its own package and each was right about its own package. **Three for three is a pattern, not bad luck** — and every one was found afterwards by a fourth session running the whole gate, which is the expensive way. Found and fixed by `yourtal-90`.

⚠️ **CRLF drift recurs and nothing prevents it.** The 2026-09-21 occurrence was working-tree-only — index and HEAD were LF throughout — and YT-0568's guard is what caught it, so this is **not** a failure of YT-0568. The remedy is YT-0568's own: delete the affected paths and `git checkout --` **those exact paths**, never `git checkout -- .`, which in a five-session tree destroys everyone's uncommitted work. Deserves its own ticket.

**Why rule 7 exists.** Rule 6 pairs a *task change* with the dashboard and says nothing about the
generator, so it does not catch the other half. `TASKS.md` is not a document that happens to be
checked — it is **output**, and output and the code that produces it are one artifact. Split them
across two commits and the first one is broken by construction: CI runs `node scripts/tasks.mjs
--check` in both `quality.yml` and `release.yml`, so a clean checkout regenerates with the OLD
generator, gets the OLD format back, and fails as stale.

The failure is nastier than an ordinary red build, which is the point worth keeping. **The commit
that breaks CI contains no cause.** A reviewer sees a dashboard diff, a legitimate one, and the
generator change that explains it is somewhere else or nowhere yet. The natural fix — regenerate
and commit again — reverts the format instead of restoring it, silently, and passes. A rule that
protects a generated file has to name its generator, or it protects the copy and not the source.

Found 2026-09-21 by `yourtal-08` and `yourtal-c8` while rebasing onto an uncommitted generator
change, **before** anyone committed it. The gap was in the rule, not in what anyone did.
