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

## Rules

1. **A task is `done` or `review` only when every AC box is ticked.** The validator enforces both.
2. **`blocked` means blocked by something outside the task graph** (a decision, a vendor, a licence). Waiting on another task is not blocked — that is `dep:`, and the dashboard works it out.
3. **No task larger than 5 days.** If it is bigger, split it. Large tasks hide risk.
4. **Every task names its acceptance criteria before work starts.** No AC, no start.
5. **Never renumber.** `cut` tasks stay in the file with `cut` status so history stays readable.
6. Regenerate the dashboard in the same commit as any task change. CI fails otherwise.
7. **Commit `scripts/tasks.mjs` in the same commit as any dashboard whose format it changes.**

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
