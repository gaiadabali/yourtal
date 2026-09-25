# Cross-session register — what the sessions are stuck on, and who can unstick it

**Snapshot taken by `yourtal-20` at 2026-09-22 06:51Z, against `b225116`.** Consolidated
from the board, `docs/13d`, the commit history and the recorded rulings — **not** from
asking the sessions. Every peer was idle at the time of writing, so nothing here has been
confirmed by its owner. Per the standing rule, **ask the session before acting on a row**;
a name in a table has been wrong repeatedly on this board.

The generator skips `_`-prefixed files (`scripts/tasks.mjs:88`), so this file is outside
`TASKS.md` and `--check` will never tell you it has gone stale. It is prose. Treat it the
same way you are told to treat the `TASKS.md` header.

**What this file is for:** the founder answers Part A, and only Part A. Everything from
Part B down is already decided or already known, and is waiting on a session to execute it.

---

## Part A — Blocked on the founder, nobody else can answer

Each of these has at least one session or ticket parked behind it.

| # | Question | What is parked behind it | Where it is recorded |
| --- | --- | --- | --- |
| **A1** | **Who owns the economy?** A named person, not an engineer. | YT-0043's finance review cannot be ticked; YT-0045's point values are placeholders; **YT-0576's materiality threshold is a number an agent invented (20%) standing in front of a two-person approval control**. | YT-0050 · TASKS.md header |
| **A2** | **Re-cut the roadmap for Australia-primary, or leave it?** | `docs/04` still reads Indonesia Phase 1 / Australia Phase 3, against a confirmed AU-primary decision. ~2 days of doc work. The *engineering* consequences are already in flight (YT-0405) because they are right either way — this is the economics, legal sequencing and phase order. | TASKS.md, "What AU-primary would change" |
| **A3** | **Where does Helios physically sit?** One Hostinger billing-page check. | The oldest blocker on the board. Evidence points to Jakarta, which makes **Australian data an APP 8 cross-border disclosure on the primary market's main path**. Nothing here can be simulated. | YT-0534 |
| **A4** | **Fast-forward `origin/production` to `main`?** | `production`'s **tip** still serves Helios's IP, the VPS hostname and the office IP. The history rewrite fixed `main` only. The fix is one fast-forward — which **fires Release and deploys to the live site inside 60 seconds**, so it is a decision, not a tidy-up. | YT-0578 · TASKS.md header |
| **A5** | **PRs, or a `push` trigger on `perf-budget.yml`?** | The performance budget (LCP ≤ 2.0s, JS ≤ 200KB, TBT ≤ 200ms) **cannot run at all** as this project actually commits. Adding `push` means Lighthouse on every commit. | YT-0569 |
| **A6** | **The seven cross-epic `web` tickets living in `phase-0-platform.md`** — re-scope the session, move the tickets into their own file, or accept that each needs two sessions to close? | YT-0501, 0512, 0525, 0526, 0550, 0551, 0564. Splitting code from ticket text is this board's most-recorded failure mode. Open since 2026-09-21. | Ownership notes, 2026-09-21 |
| **A7** | **Adopt the Infisical that is already on the box?** | YT-0533 was written as "secrets without a KMS" and **that premise is wrong** — `/opt/infisical-core` is self-hosted and running. It is shared with the 30 client sites and the NOW platform, so adopting it applies risk 39's blast-radius argument to credentials. | YT-0533 |
| **A8** | **Who takes `policies/` and `.github/workflows/`?** | Filed as unheld since `yourtal-e3` ended. `policies/` carries **YT-0574/0575**, the two-person-approval control that is switched off by an attribute being absent. Unowned means nobody is closing them. | Ownership ruling, 2026-09-21 |
| **A9** | **The fifteen blocking business questions** — cash-out model, what the business pays us on top of funding the reward, fixed or floating points rate, entities, K1/K2/K6/K11. | Not session-blocking today; launch-blocking. Phase 1 scope, the monetary policy docs and the legal sequencing all rest on them. | `docs/05-open-questions.md` |

---

## Part B — Already ruled. Sessions execute; no further decision needed.

1. **Incumbents keep the epics they hold** (founder, 2026-09-21 ~23:00). The reassignment
   that preceded it was built on the hand-maintained `TASKS.md` table, and four epics were
   handed to a new session mid-ticket. **A peer cannot re-scope another peer, and a session
   name that vanished means the address changed, not that the work was abandoned.**
2. **IDR is stored in sen** (founder, 2026-09-20). Settles the currency, not the processor;
   what Xendit accepts is unconfirmed and the conversion belongs in the PSP adapter. The
   100× migration runs as one unit of work behind the drift test.
3. **The reward is a reward, not a wage replacement** — under AUD 5 per twenty minutes,
   partner-funded and therefore variable. `docs/23` §2.6's critique is a risk to test, not a
   defect to fix.
4. **Legal proceeds without advisory counsel**, positions recorded in `docs/24`. A notaris
   and a local corporate services provider remain mandatory.
5. **YT-0451 is not closed by its protocol existing.** Its boxes close when 25 sessions have
   been run across **both** markets and written up. Australia answers the reward question;
   Indonesia cannot.

---

## Part C — What the sessions need from each other (the shared working tree)

Five or more sessions commit from one checkout and one `.git/index`. This is the largest
single source of lost work on this project, and every obvious fix has already been tried and
has already failed. **Do not re-derive these.**

**The commit sequence, and it is not negotiable:**

```
git diff --numstat -- <paths>    # inspect the WORKING TREE; the index is never occupied
git commit -- <paths>            # commit those paths directly
```

- **Never `git add` and then commit as a separate step.** The window is seconds: a file was
  staged, inspected, and swept into another session's commit before its own `git commit`
  ran — `7798bc1`, a watch-epic commit, carries a 117-line infra file it says nothing about.
  Third instance in one day across three sessions, which makes it a mechanism rather than a
  discipline problem.
- **Never `git add -A`.** It stages every live session's in-flight work into one
  plausible-looking commit, authored by whoever typed it.
- **Never use a relative ref.** `HEAD~1`, `@{1}`, `--amend` and `ORIG_HEAD` resolve against a
  pointer another session moves between your reading it and your using it. A
  `reset --soft HEAD~1` aimed at one session's own commit undid a different session's, and
  left that work staged and looking like the first session's. Resolve the absolute SHA,
  confirm it is the commit you think it is, then operate on that.
- **A private `GIT_INDEX_FILE` is safe only with `git read-tree HEAD` in the same command.**
  Without it, the next session commits a stale index and **deletes your new files** — 607
  lines on 2026-09-21, spotted and restored by another session.
- **Pathspec commits protect files, not hunks.** On a carrier file — one whose job is to be
  appended to by everyone: export maps, `atlas.sum`, drift tables, `package.json` exports —
  use `git add -p` and stage only your hunk. Land the *source* before the line that points at
  it; an export whose target is untracked breaks every clean checkout, and you do not control
  who commits the carrier next.
- **Two invariants worth more than any habit:** a file that is both `??` and present in HEAD
  means the index is stale and the next commit will delete it; and the index can be staged to
  delete a file that exists both on disk and in HEAD, invisibly to `git status` — only
  `git diff --cached` shows it.
- **Uncommitted work has no author and no timestamp.** Minutes-old and month-old work look
  identical, so every observation of the tree reads like a settled fact. Timestamp your
  claims, run `git diff` before attributing a change to anyone, and announce your own
  in-flight paths.
- **`.claude/worktrees/**` sits inside the repo root.** A recursive `find` or `grep -r`
  reaches every other session's checkout, and a hit there is indistinguishable from a real
  finding — one sweep returned 33 files, 22 of them inside worktrees. Exclude it explicitly;
  `.gitignore` constrains git, not the filesystem.
- **Board commits take two rules, not one:** regenerate `TASKS.md` in the same commit as any
  task change (rule 6), **and** stage `scripts/tasks.mjs` alongside any dashboard whose
  format it changed (rule 7 — this landed, `_schema.md:152`).

---

## Part D — The gates

- **`pnpm verify` is sequential** — `check:eol && format:check && typecheck && lint && test
  && policy:test && tasks:check`. Fixing the front gate does not mean the tree is healthy; it
  means you can now see gate two. **Never report "verify is unblocked" after fixing one gate.
  Re-run it.**
- **Its first gate is a supply-chain lockfile check**, so one session's `pnpm install` reds
  the commit rule for every session at once, and the failure names a package rather than a
  session — it reads like infrastructure. **If it blocks you, do not re-resolve the lockfile
  and do not relax the policy.** Confirm the drift is uncommitted with
  `git show HEAD:pnpm-lock.yaml`, find the owner, and verify your own work per package with
  `--config.verifyDepsBeforeRun=false`, **stating plainly which gates you ran and which you
  did not.** Do not commit on a red that is someone else's — that reasoning produced three
  broken commits in one day.
- **When a suite cannot start, your change is `unrun`, not `passing`.**
- **CI is executing again.** The `TASKS.md` banner saying nothing has run since 15:14 on
  2026-09-21 is **stale as of 06:51Z today**: runs on `b225116` and its parents have real
  durations — Quality ✅ 21m, CodeQL ✅ 45m, Format ❌ 18m, Integration ❌ 16m. The reds mean
  something again, so **Format and Integration are genuinely red on `main`** and somebody
  owns that. Correcting the banner is a hand edit; regenerating will not do it.
- **Five no-skip guards in `integration.yml` have only ever been seen passing.** House rule:
  a guard first seen green has not been shown to work. One deliberate `it.skip` should be
  pushed to watch it go red (YT-0569; see A5).

---

## Part E — Shared infrastructure, one line each

- **Never run `pnpm dev:reset` or `docker compose down -v`.** `dev:reset` *is* `down -v`, runs
  neither `db:migrate` nor `db:seed`, and destroys every database in the shared cluster —
  currently `yourtal`, `yourtal_wt_policy` and Zitadel's realm — handing back an empty one.
  **`pnpm dev:fresh` is the command that rebuilds.** YT-0519's criterion still tells the
  reader to run `dev:reset`, which is why that ticket failed verification.
- **Nobody restarts shared infrastructure unilaterally.**
- **MinIO's S3 port `26900` is not published** though compose declares it, so
  `packages/media`'s origin tests fail loud by design. Not a regression, and not yours.

---

## Part F — Things that are true and are recorded wrongly

Each of these has cost three sessions a day, at least once.

1. **`TASKS.md` above line 82 is hand-maintained prose.** The generator never rewrites it and
   `--check` never flags it stale. It has named live sessions as dead, declared held epics
   unowned, and carried an invented session name for three hours. **Read `docs/tasks/*.md`
   for status; ask the session for ownership.**
2. **The CI banner in that header is stale** — see Part D.
3. **This file is the same kind of object.** It was accurate at 06:51Z on 2026-09-22 and
   carries no guarantee after that.

---

## What I would do first

1. **Founder: A1 and A3.** A1 unblocks three tickets and removes an invented number from in
   front of a two-person control. A3 is one billing page, and it decides whether Australian
   personal data may legally land on the box the product is already deployed to.
2. **Whoever takes `.github/workflows/` under A8: the red Format and Integration on `main`.**
   They are real signal again as of this morning, and have been treated as noise since
   yesterday afternoon.
3. **The recorder: correct the CI banner and the ownership table by hand**, because nothing
   else will.
4. **Everyone: Part C is the commit sequence.** It is the difference between this project
   losing an afternoon of someone's work and not.
