# YourTal — Finish Plan

**Finish line:** YourTal running end to end on **Helios as a staging environment** the founder can review live.

- **Two regions, fully separate:** **Australia** (the default: English, AUD) and **Indonesia** (IDR, Bahasa available). Each has its own points, rates, tax and policy; nothing crosses between them.
- **Correct engines** and a redesigned **video-first** UI.
- **Payments, email, SMS, KYB and moderation are simulated** behind drivers.
- **Not a production launch:** demo users and simulated money. Helios itself is fine for production later.

Written 2026-09-25 from a full audit of the code, then checked by five independent critics. The evidence behind every task is in [`docs/audit/2026-09-25/`](docs/audit/2026-09-25/). This file replaces the old generated board, which is archived in [`docs/tasks/`](docs/tasks/README.md).

**Where we actually are (verified, not taken from the old board):**

- **The parts are good, but nothing is connected.** The Go ledger and voucher libraries pass their tests, the email+password auth API is real, and the Cerbos policies are solid. But every web screen reads fixtures, every ledger HTTP route returns 501, watch completion is hard-coded to refuse, and the API trusts caller-supplied identity headers.
- **HEAD does not compile.** Commit `b225116` leaves 35 TypeScript errors in web and 29 in api. `atlas.sum` is stale, so migrations refuse to run, and every store price renders `NaN`.
- **The engines are wrong in ways that matter.** 60 of the 64 engine defects found were confirmed by an adversarial second reader:
  - a merchant sets its own points price;
  - points are minted with no cash behind them;
  - two burns can overdraw a balance;
  - every reward is a hard-coded 2,400 pts (about AUD 72);
  - solvency is never enforced;
  - AUD vouchers cannot be redeemed;
  - the watch loop can be farmed (600 reports in 3 s covered an 1,800 s video).
- **Indonesian by default** because of `DEFAULT_REGION = "ID"` (`apps/web/features/region/get-region.ts:11`), about 57 hard-coded Indonesian strings, and 22 `id-ID` default parameters.
- **The UI looks broken because it half is.** Tailwind never scans `packages/ui`, so dialogs open off-screen and badges fail contrast. There is no imagery anywhere, and the copy cites ticket numbers to users.
- **The live site is only the web prototype.** It shows fixture data, and `/business`, `/merchant` and `/wallet` open without a login.

## Progress

Rebuilt from the checkboxes by `node C:/Users/Hansel/Documents/Hansel/Projects/yourtal/scripts/progress.mjs`.

<!-- progress:start -->
| Phase | Area | Status | Tasks | Subtasks | Progress |
| --- | --- | --- | --- | --- | --- |
| **Phase 0** Reset | A | 🔄 in progress | 5/8 | 38/47 | `████████░░`  81% |
| **Phase 1** Identity, contracts & plumbing | A | · not started | 0/7 | 0/43 | `░░░░░░░░░░`   0% |
| **Phase 2** Staging on Helios | A | · not started | 0/3 | 0/15 | `░░░░░░░░░░`   0% |
| **Phase 3** Design language | B | · not started | 0/6 | 0/31 | `░░░░░░░░░░`   0% |
| **Phase 4** The bank is correct | A | · not started | 0/9 | 0/49 | `░░░░░░░░░░`   0% |
| **Phase 5** Watch & earn | B | · not started | 0/5 | 0/21 | `░░░░░░░░░░`   0% |
| **Phase 6** Viewer app | B | · not started | 0/8 | 0/29 | `░░░░░░░░░░`   0% |
| **Phase 7** Business studio | C | · not started | 0/8 | 0/33 | `░░░░░░░░░░`   0% |
| **Phase 8** Voucher engine for clients | C | · not started | 0/4 | 0/14 | `░░░░░░░░░░`   0% |
| **Phase 9** Staff console | C | · not started | 0/6 | 0/18 | `░░░░░░░░░░`   0% |
| **Phase 10** Settlement, lifecycle & risk | A | · not started | 0/4 | 0/15 | `░░░░░░░░░░`   0% |
| **Phase 11** Public site | B | · not started | 0/3 | 0/10 | `░░░░░░░░░░`   0% |
| **Phase 12** Teen & family mode | A + B + C | · not started | 0/4 | 0/13 | `░░░░░░░░░░`   0% |
| **Phase 13** Ready for live review | all | · not started | 0/6 | 0/15 | `░░░░░░░░░░`   0% |
| **All** | | | **5/81** | **38/353** | `█░░░░░░░░░`  11% |
<!-- progress:end -->

## Running order: which phases to start

**One session runs one phase**, from its first task to its **Done when**, in a free slot (see **Now**). Start a phase once everything in its "Starts when" column is ✅. Phases in the same wave touch different files, so they can run side by side. Run 2 or 3 sessions at once, as you like: about 6 weeks with 3 sessions, about 8 with 2.

| Wave | Phase (one session each) | Starts when | Size |
| --- | --- | --- | --- |
| 1 | **0** Reset | now (in progress) | ~2.5d |
| 1 | **3** Design language | 0.2.b ✅. It needs no database. Until 0.3, 0.5 and 0.7 are merged it stays out of `apps/web/features/**`, `app/(app)/**`, `app/(merchant)/**` and the existing e2e specs, and its first merge waits for 0.4. | ~6d, plus your F3 pick |
| 2 | **1** Identity, contracts & plumbing | Phase 0 ✅ | ~4d |
| 3 | **4** The bank is correct | Phase 1 ✅ | ~9d |
| 3 | **5** Watch & earn | Phase 1 ✅ | ~5d |
| 3 | **2** Staging on Helios | Phase 1 ✅. Start it as soon as a slot is free: after it, every merge is live on staging. | ~2.5d |
| 4 | **7** Business studio | Phase 1 ✅. Its 7.7 also needs 5.4, and its UI task 7.8 needs Phase 3. | ~9d |
| 4 | **10** Settlement, lifecycle & risk | Phase 4 ✅ | ~5d |
| 5 | **6** Viewer app | Phases 3 and 5 ✅, plus 7.4 and 7.7 | ~7d |
| 5 | **8** Voucher engine for clients | Phases 4 and 5 ✅ | ~5d |
| 5 | **11** Public site | Phases 3 and 7 ✅ | ~3d |
| 6 | **9** Staff console | Phases 7 and 10 ✅ | ~5d |
| 6 | **12** Teen & family mode | Phases 7 and 10 ✅ | ~3d |
| 7 | **13** Ready for live review | every other phase ✅ | ~3d |

**Never run these two at once:** 4 and 10 (both rewrite `services/ledger`), and 5 and 6 (both change the player and watch flow). The waves above already keep them apart.

## Now

One row per slot. The session in a slot updates its row when it starts, when it finishes a task, and when it stops.

| Slot | Worktree | Phase | Since | Note |
| ---- | -------- | ----- | ----- | ---- |
| 1 | `yourtal-1` | **0** Reset | 2026-09-25 | 0.2, 0.3, 0.5, 0.6 ✅; 0.4.a–e ✅. Now: 0.4.g (CI green on main), then 0.7, 0.4.f, 0.8.f–j (session yourtal-74) |
| 2 | `yourtal-2` | — free | — | Phase 3 can start now (0.2.b ✅); worktree, `.env` and deps are ready |
| 3 | `yourtal-3` | — free | — | Next: Phase 1, once Phase 0 ✅ |

## Decisions for the founder

**How any session asks:** use `AskUserQuestion`. Offer 2–4 options with the **recommended one first, labelled "(Recommended)"**, and one line on what each option means. Record the answer here (and in `docs/16` when it changes a decision). Until the founder answers, the recommended option is used, so work never waits.

### Open

| # | Question | Options (recommended first) | Needed by |
| --- | --- | --- | --- |
| **F3** | Which design variant? Asked with the prototype videos from 3.2. | **After Dark** (used if there is no answer 24 h after 3.2.f) · Daylight | 3.3 |
| **F9** | Who owns the economy numbers? | **The founder, for now** · Name a person | First real user; not needed for staging |

### Founder actions (not questions)

| # | Action | Why |
| --- | --- | --- |
| **FA1** | An org owner of `gaiadabali` enables **Dependabot alerts, Dependabot security updates, secret scanning and push protection** for `gaiadabali/yourtal` (Settings → Advanced Security), and gives the `hansel-gaiada` gh account **security-manager** (or admin) access, so sessions can read the alerts. | Both local gh accounts have only "pull" access, so the alert lists could not be read on 2026-09-25 (they return 403 / 404). Task 0.8 fixes every advisory the dependency graph shows. |

### Answered 2026-09-25

| # | Decision | Answer |
| --- | --- | --- |
| **F1** | AU price per point (P_issue) | **4.5¢**: a 33% spread over B (3¢), the same spread as Indonesia (IDR 9 / IDR 6). "Best mechanics for now"; it can be changed in the staff console with two-person approval (9.5). |
| **F2** | Regions and money | **AU is AU and ID is ID, fully separate.** Each has its own currency, points, rates, tax and policy, and nothing crosses between them. **One system with hard walls**, not separate databases: every row, account and job is region-scoped and enforced in the database, the ledger and Cerbos. **Points never expire by default.** Expiry is built, switched off, and settable per region in the staff console. **Helios is acceptable for production later.** At this stage users are demo accounts. |
| **F4** | Teen accounts | Ages 13–17 with parental consent, on an age-rated feed like YouTube Kids; products for young children target parents; no accounts under 13. On in staging only until counsel reviews it (12.4). This reverses C4. |
| **F5** | Staging access | Open, with a banner and `noindex`. Staff demo logins are **not** published on the site (13.2). |
| **F6** | Repo visibility | Stays public. |
| **F7** | Demo videos | Stock clips (Pexels, short and vertical) plus open films (Blender Foundation, CC-BY, long-form). Each is branded per demo business with on-screen facts, so questions can be answered from the video. Licences are recorded. |
| **F8** | Open Viewing | On. Only campaigns that opt in **and** are rated all-ages play logged-out, rate-limited per visitor, and nobody earns. |
| **F10** | When questions are asked | **During the video**, at server-chosen moments. The video pauses, the viewer gets a 30 s timer, and a timeout counts as wrong but never voids the watch. Under 60 s: no questions. From 60 s to under 10 min: 1. Longer: one per 5 min, up to 5. That is `max(1, min(5, floor(d/300)))` for d ≥ 60 s. |
| **F11** | Voucher engine | A first-class deliverable for YourTal, brands and users: **generation, redemption and a client SDK**, secure and tamper-evident (a hash chain anchored in the daily proof, with the root published). No blockchain for now. |
| **F13** | Do new (tier 0) accounts earn less? | **No.** Every account earns the full advertised terms; the tier only sets how long points stay pending (F12). |
| **F14** | Does the reward ceiling include the accuracy bonus? | **Yes.** Base + maximum bonus must fit under the ceiling, so 20 min in AU always stays under AUD 5. |
| **F15** | Quick campaigns in the feed | **Under 60 s, no question.** Swipe, watch, earn. Anything 60 s or longer opens the full player. |
| **F16** | Whose clock decides a streak day? | **One clock per region:** AU uses Australia/Sydney, ID uses Asia/Jakarta. |
| **F12** | Economy numbers for staging | Set by the plan ("best mechanics for now"). Every one is a config value editable in the staff console (9.5) through the 1.2.f settings store, never a constant in code. See the table below. |
| **F17** | Migration `20260922030000` opened its own transaction inside Atlas's, so it could never apply | **Fix it in place.** It had never been pushed or applied anywhere (no `atlas.sum` line; dev stopped at `20260922020000`). "Never edit a migration" protects applied history; an unapplied, unpushed one may be fixed. |
| **F18** | F2's no-expiry weakens `docs/24` ID-1, which cited expiry as one of its four legs | **Off in both regions, for good.** Keep expiry built and switchable per region in the staff console. `docs/24` and `docs/25` now record ID-1 as resting on three legs. |

**F12 defaults**, per region (AU / ID):

| Setting | Default |
| --- | --- |
| Reward ceiling | **8 / 150 pts per minute, including the maximum accuracy bonus** (F14), so 20 min in AU stays under AUD 5. Studio refuses anything higher. |
| Demo campaign rewards | 5 / 80 pts per minute. Accuracy bonus is 25% in the demo, capped at 40% of base (J10). |
| Streak | A streak day is a calendar day on the region clock (AU: Australia/Sydney, ID: Asia/Jakarta; F16) with ≥ 1 completed reward session. The bonus pays on day 3 and day 7: 5 then 10 pts / 60 then 120 pts. Paused while coverage is below 1.1. A broken streak never costs points. |
| snap-app receipt | 10 / 100 pts, one per receipt hash per partner. |
| Daily earn cap | 500 / 5,000 pts. Teens get half. The monthly cap is 30× the daily cap. |
| Holdback by trust tier | 72 / 48 / 24 / 0 h. Tier 1 = verified email + 7 days. Tier 2 = 30 days + 10 clean completions. Tier 3 = staff-set only. **Demo viewer accounts are tier 3.** The tier is never shown to users. |
| Goodwill per case | ≤ 500 / 5,000 pts. |
| Marketing budget | AUD 5,000 / IDR 50,000,000. Funds streaks, receipts and goodwill (K6). |
| Points packs | Multiples of 1,000 pts: AU 1,000 pts = AUD 45.00, ID 1,000 pts = IDR 9,000. |
| Settlement | Dispute window 7 days. Payable per capture = ceil(S × captured ÷ face value). |
| Cohort floors | Business reports never show a group smaller than 10 (teens 20). Interest targeting needs a segment of ≥ 1,000 (staging: 1). |
| Open Viewing | 60 min per IP per day, one concurrent anonymous session. |
| Sessions | Consumer: 30 days sliding, 90 days absolute. Staff: 12 h. |
| Teen quiet hours | 21:00–07:00 local time: no notifications and no new reward sessions. |

## How to update this file — the rule

This file is how the founder sees progress without asking. **It is updated as work happens, not afterwards.** The same rule is in `CLAUDE.md`, so every session loads it.

1. **Starting a task:** append `— 🔄 slot 2` (your slot) to the task line, and update your slot's row in **Now**.
2. **Finishing a subtask:** tick it `[x]` **straight away** in the **main checkout's** `TASKS.md`, then run `node C:/Users/Hansel/Documents/Hansel/Projects/yourtal/scripts/progress.mjs`. Do not save ticks up for later. Re-read the file just before each edit, because other sessions are ticking too.
3. **Finishing a task:** only when every subtask is ticked **and** its **Check** passed on merged `main`. Tick the task line, replace `🔄` with `✅ YYYY-MM-DD <short sha>`, add one line to the top of **Log**, update **Now**, then commit `TASKS.md` (command below).
4. **Blocked:** append `— ⛔ <reason>` to the task line, note it in **Now**, and move to your next unblocked task.
5. **New work you discover:** add it as a subtask, or as a new task at the end of the right phase, with the next free ID. **Never delete a task.** If one is dropped, append `— ✂️ cut: <reason>`; the progress script then stops counting it.
6. **Edit only your own phase's lines**, your slot's **Now** row and your **Log** lines. Ticks are facts, so committing another session's ticks together with yours is fine.
7. **Work in task order within your phase.** A phase that states its own order overrides this.
   - `needs:` says what must be ✅ first; a need like `7.2.f` means that one subtask.
   - A need marked "(fake ok)" can be built now against the 1.2 fakes, or against the contract's mock data where no fake exists.
   - Tick the Check for such a task only once the real thing is merged. If that lands after your phase ends, leave the Check open with ⛔ and the task it waits for; the next session in that phase finishes it.

**What "done" means here:**

- A wired feature: an **HTTP round trip plus the database row it should write**.
- UI: **screenshots at 390 px and 1280 px, light and dark, with axe clean**.
- A library passing its own tests is not done. That is how the old board reached "83 done" with nothing working.

## Areas and ownership

Every phase belongs to one area (A, B or C, shown in its heading). A phase session edits only its area's paths and the shared files, even when another phase of the same area is not running. **Phase 0, task 1.1, subtasks 1.5.a, 1.5.b and 1.5.d, and 12.1.b are exempt**: they put fixes and the region and audience walls into everyone's files at once. Announce each in **Now** before starting.

| Area | Owns |
| ---- | ---- |
| **A — Bank & platform** | `services/**` · `packages/{db,drivers,queue,idempotency,authz,jurisdiction,consent}/**` · `policies/derived_roles/**` · `apps/api/src/{main.ts,config,shared}/**` · `apps/api/src/modules/{auth,identity,checkout,wallet}/**` · `apps/worker/**` (the runner) · `apps/web/lib/api/**` · `apps/web/proxy.ts` · `apps/web/app/dev/**` (inbox, clock) · `infra/**` · `docker-compose*.yml` · `.github/**` · `.gaiadeploy.yml` · root configs (`package.json`, `turbo.json`, `pnpm-workspace.yaml`, `eslint.config.mjs`, `eslint-rules/**`) · `scripts/**` |
| **B — Viewer app** | `packages/ui/**` · `apps/web/app/{globals.css,root-document.tsx,robots.ts,sitemap.ts,sw.ts}` · `apps/web/app/{(app),(public),(auth),(lab)}/**`, except `(app)/business/**` · `apps/web/features/{auth,campaign,player,checkpoint,quick,store,burn,wallet,me,streak,shell,onboarding,region,open-view,public,notifications,rum}/**` · `apps/web/{i18n,public}/**` · `apps/web/{next.config.ts,playwright*.config.ts}` · `apps/web/messages/*/*` except C's files · `apps/api/src/modules/{watch,campaign,me}/**`, except `campaign/persistence/schema/**` |
| **C — Business side** | `apps/web/app/{(business),(merchant),(staff)}/**` and `(app)/business/**` (which it moves out) · `apps/web/features/{console,studio,merchant,staff}/**` · `apps/web/messages/*/{studio,merchant,staff}.json` · `apps/api/src/modules/{business,studio,store,billing,devices,partners,staff,reports,feed}/**` · `apps/api/src/modules/campaign/persistence/schema/**` (C writes the campaign and question tables; B reads them) · `packages/media/**` · `packages/sdk-merchant/**` |
| **Shared (add your lines only)** | `eslint.config.mjs` (one block per area, for its own paths) · root `package.json` `scripts` · `apps/web/route-redirects.ts` · `apps/api/src/app.module.ts` · `apps/api/src/config/env.schema.ts` (every new variable needs a dev default) · `.env.example` · `apps/*/package.json` (through pnpm only) · `pnpm-lock.yaml` (pnpm only) · `packages/db/migrations/**` (add-only) · `packages/db/src/seed/*.ts` (one file per domain; 1.3 splits it) · `packages/contracts/src/openapi/route-registry.*.ts` (one per area; 1.3 splits it) · `packages/contracts/src/**/drift` test tables · `policies/resource_policies/<resource>.yaml` and its test, owned by whoever owns the module · `packages/authz/src/resources.ts` · `apps/worker/src/jobs/*.ts` (one file per job) · `apps/web/e2e/<area>-*.spec.ts` (each owned by its prefix, `a-`, `b-` or `c-`) · `TASKS.md` (your own lines) |

**Contract folders in `packages/contracts/src/`:**

- **A:** `money`, `region`, `identity`, `ledger-internal`, `voucher-internal`, `voucher`, `wallet`, `balance`, `checkout`
- **B:** `watch`, `feed` (response shape), `me`, `interest`, and in `question/` the files `presented-question`, `question-selection` and `question-response-signals`
- **C:** `business`, `studio`, `listing`, `billing`, `device`, `merchant`; in `campaign/` the files `campaign-lifecycle`, `campaign-reward-config`, `campaign-terms` and `campaign-chapter`; in `question/` the files `question`, `question-bank` and `question-leak-signals`
- The rest of `campaign/` is B's.

**If you need something another area owns:** add a subtask to that area's relevant task, marked `(requested by B)`, and build against the contract or the fake in the meantime. Do not edit their files.

## Session protocol

**Starting or resuming a phase.** Pick the phase from **Running order**. Open a free slot's worktree folder, for example `C:/Users/Hansel/Documents/Hansel/Projects/yourtal-2`, in VS Code or with `claude` in a terminal. Paste this, changing the phase number and name:

> You are the session for **Phase 4 — The bank is correct** on YourTal. The main checkout (the control room) is `C:/Users/Hansel/Documents/Hansel/Projects/yourtal`. Read `CLAUDE.md`, then `TASKS.md` there.
>
> 1. Claim this worktree's slot: write your phase into its row in **Now**.
> 2. Work here on the branch `phase/4`. For a new phase: `git switch -c phase/4 main`. When resuming: `git switch phase/4 && git rebase main`. Then run `pnpm install --frozen-lockfile && pnpm db:migrate`.
> 3. Do Phase 4's tasks in order. A phase that states its own order overrides that.
> 4. As you go: mark each task 🔄 when you start it, tick each subtask in the main checkout's `TASKS.md` as soon as it is done, and run its `progress.mjs`.
> 5. Merge to `main` at the end of each task, and at each green subtask where you can, using the session protocol. Commit at every clean boundary.
> 6. If a task needs something from a phase that is not done: when the need says "(fake ok)", build against the fake. Otherwise mark the task ⛔ with the task it waits for, and carry on.
> 7. Stop when the phase's **Done when** holds, or when everything left is ⛔. Then update your slot's row in **Now**: free it, or say what it waits for.
> 8. If you need the founder, ask with options and a recommendation.

**Slot setup.** Once, in task 0.2. Run it in Git Bash with literal paths, because shell variables do not persist between tool calls.

```bash
cd C:/Users/Hansel/Documents/Hansel/Projects/yourtal
git worktree add --detach ../yourtal-2 main
cp .env.example ../yourtal-2/.env   # not .env: the main .env lacks CHECKPOINT_TOKEN_SECRET and the ledger/voucher URLs
# edit ../yourtal-2/.env now (0.2.b), before any pnpm db:* command
mkdir -p ../yourtal-2/.claude && printf '{"permissions":{"additionalDirectories":["C:/Users/Hansel/Documents/Hansel/Projects/yourtal"]}}\n' > ../yourtal-2/.claude/settings.local.json
cd ../yourtal-2 && pnpm install --frozen-lockfile
# once 0.3.c is on main (0.2.e): node packages/db/scripts/test-db.mjs create yourtal_s2
```

The settings file lets the session edit the main checkout's `TASKS.md` from its worktree. Do not commit it. Never run a `pnpm db:*` command in a worktree whose `.env` still names the `yourtal` database.

**When a phase is done:** once its branch is merged, run `git branch -d phase/4` and `git switch --detach main`, and free the slot in **Now**. The slot's database and ports stay; the next phase reuses them.

**Each merge.** One line, repeated whole if the fast-forward fails:

```bash
cd C:/Users/Hansel/Documents/Hansel/Projects/yourtal-2 && git rebase main && pnpm install --frozen-lockfile && pnpm db:migrate && pnpm check && git -C C:/Users/Hansel/Documents/Hansel/Projects/yourtal merge --ff-only phase/4 && git -C C:/Users/Hansel/Documents/Hansel/Projects/yourtal push origin main
```

**`TASKS.md`:** always edit the main checkout's copy by absolute path, never your worktree's. Commit it on its own:

```bash
node C:/Users/Hansel/Documents/Hansel/Projects/yourtal/scripts/progress.mjs && git -C C:/Users/Hansel/Documents/Hansel/Projects/yourtal commit -m "tasks: 4.2 done" -- TASKS.md && git -C C:/Users/Hansel/Documents/Hansel/Projects/yourtal push origin main
```

**Rules that prevent the collisions the last week had:**

- **The main checkout stays on `main` and holds no code edits.** Phase branches never touch `TASKS.md`. If a fast-forward complains about `TASKS.md`, run `git checkout main -- TASKS.md` in your worktree, commit, and retry. **Never stash, checkout or reset anything in the main checkout** (0.1.a and 0.1.c are the only exceptions: they run before any worktree exists).
- **Never rewrite pushed history** or force-push `main`. Use absolute SHAs, never `HEAD~1`.
- **Your own dev data.** Each slot worktree has its own database (`yourtal_s1`, `_s2`, `_s3`), Valkey DB index, MinIO bucket and Cerbos container (0.2).
  - Only the main checkout runs `pnpm dev:up`. **Nobody runs `pnpm dev:reset` or `pnpm dev:fresh` once worktrees exist:** `down -v` deletes the shared Postgres volume, and every slot's database with it.
  - Worktrees run no `docker compose` command at all, because with `name: yourtal` it acts on the shared stack.
  - Reset only your own data, with `pnpm db:reset:slot`.
  - Tests use `yourtal_test_*` databases, never a dev database.
- **Migrations:**
  - Any phase may add one. Never edit one that is on `main`.
  - Before merging, if `main` has a migration newer than your unmerged one, `git mv` yours to a fresh `date -u +%Y%m%d%H%M%S` name and re-run `pnpm --filter @yourtal/db migrate:hash`.
  - On an `atlas.sum` conflict during a rebase: `git checkout --ours packages/db/migrations/atlas.sum` (during a rebase, "ours" is `main`), then `pnpm --filter @yourtal/db migrate:hash && git add packages/db/migrations/atlas.sum && git rebase --continue`.
- **Other conflicts:**
  - `pnpm-lock.yaml`: `git checkout --ours pnpm-lock.yaml && pnpm install && git add pnpm-lock.yaml && git rebase --continue`. Never hand-edit it.
  - Generated OpenAPI (`packages/contracts/openapi/**`): take `main`'s copy, regenerate, add.
  - Everything else: keep both sides.
- **`.git/index.lock` in the main checkout:** wait 10 s and retry. Never delete it.
- **Environment variables:** every new one gets a dev default in `apps/api/src/config` and a line in `.env.example`. After a rebase, add any keys from `.env.example` missing from your `.env`.
- **Ports:**

  | Slot | web | api | ledger | voucher | Playwright | Cerbos |
  | ---- | --- | --- | ------ | ------- | ---------- | ------ |
  | 1 | 26310 | 26311 | 26312 | 26313 | 26314 | 26315 |
  | 2 | 26320 | 26321 | 26322 | 26323 | 26324 | 26325 |
  | 3 | 26330 | 26331 | 26332 | 26333 | 26334 | 26335 |

  The main checkout keeps the existing ports. Record everything in `infra/PORTS.md`.
- **Commit as you go.** A quota cut-off can end a session mid-task, and uncommitted work is how 85 files nearly vanished last week.
- **Keep comments short and say why.** No essays, no ticket IDs or doc references in user-facing copy, and no new process documents.

---

## Phase 0 — Reset · Area A · ~2.5d

One session, from day 1. Unbreak `main`, retire the old process, move IDR to whole Rupiah, get every gate green, and give each slot an isolated environment. Nothing else can merge until this compiles.

**Where Phase 0 runs.** 0.1 and 0.2.b–d run in the main checkout. After 0.2.b, **the Phase 0 session restarts in `yourtal-1`** with the start prompt, which gives it a clean permission scope, and every later edit happens there. Until 0.4.a exists, the merge line runs the task's own Check instead of `pnpm check`. **Until 0.3.f passes, leave `&& git … push origin main` out** of both the merge line and the `TASKS.md` commit line.

- [x] **0.1 Land the plan and save the leftovers** · needs: — — ✅ 2026-09-25 fbd26c0
  - [x] 0.1.a Save the uncommitted files from earlier sessions to a branch, not to `main`:
    - `git stash push -m leftovers -- apps/api/src/modules/business docs/24-legal-positions.md docs/25-monetary-policy.md .claude/agents/kfc .claude/system-prompts`
    - `git worktree add ../yourtal-wip -b wip/leftovers-2026-09-22 HEAD`
    - `git -C ../yourtal-wip stash pop`
    - fix the raw NUL byte in `drizzle-business-onboarding.unit-of-work.test.ts` (write it as `"\u0000"`)
    - commit as "WIP from earlier sessions, unverified"
    - `git worktree remove ../yourtal-wip`
  - [x] 0.1.b Commit this plan: `TASKS.md`, `CLAUDE.md`, `scripts/progress.mjs` and the deletion of `scripts/tasks.mjs` (archived as `docs/tasks/_generator-v1.mjs`), `.gitignore` (with `TASKS.md.lock`, `.claude/settings.local.json` and `apps/web/public/lab-media/`), `docs/audit/2026-09-25/`, the archive of the old board in `docs/tasks/`, and the gate removals (`quality.yml`, `release.yml`, `package.json`, `.githooks/pre-commit`, `.prettierignore`, `.gitattributes`, `README.md`). This closes the old board (EW-23).
  - [x] 0.1.c Fast-forward `main` to this branch and check out `main` in the main checkout. It keeps `b225116`, whose currency tagging we need; 0.3 finishes it. Do not push until 0.3 compiles.
  - [x] 0.1.d **Check:** `git status` is clean on `main`, and `wip/leftovers-2026-09-22` holds the leftovers.
- [x] **0.2 One isolated environment per slot** · needs: 0.1 (0.2.e needs 0.3.c) — ✅ 2026-09-25 efffeda
  - [x] 0.2.a Add a top-level `name: yourtal` to `docker-compose.yml`. Zitadel is already removed (0.8.d). The worker (1.3) runs on the host with ffmpeg on PATH (this machine has ffmpeg 8.1.2 from winget); record that in `infra/PORTS.md`, and add no worker image or compose service. `pnpm dev:up` from the main checkout comes up healthy.
  - [x] 0.2.b Create the slot worktrees `../yourtal-1|2|3`, detached at `main` (setup commands above), each with `.claude/settings.local.json`. Each worktree's `.env` (copied from `.env.example`) gets:
    - the database `yourtal_s1|s2|s3` in DATABASE_URL, DATABASE_OWNER_URL, LEDGER_DATABASE_URL and VOUCHER_DATABASE_URL;
    - `REDIS_URL=redis://127.0.0.1:26379/1|2|3`;
    - `S3_BUCKET=yourtal-media-1|2|3` (there is no prefix setting);
    - no pg-boss change, since each slot's own database already isolates the `pgboss` schema;
    - `PORT` (api), `WEB_PORT`, `PLAYWRIGHT_PORT` and `PDP_BASE_URL` from the ports table.

    `apps/web` gets `scripts/dev.mjs`, which loads the root `.env` and runs `next dev -p $WEB_PORT`. Both Playwright configs read `PLAYWRIGHT_PORT`; the offline config uses 26316, 26326 or 26336. The ledger and voucher ports stay reserved for 4.1; until then every slot uses the shared containers.
  - [x] 0.2.c Add the scripts `pnpm db:reset:slot` (drop, create, migrate and seed only this worktree's database) and `pnpm dev:cerbos` (run a Cerbos container named `yourtal-cerbos-1|2|3` on this worktree's port, mounting this worktree's `./policies`).
  - [x] 0.2.d Run `git worktree prune`. List the `worktree-agent-*` branches; delete those with no unmerged commits and note any that have some. Done 2026-09-25: nothing to prune; both `worktree-agent-*` branches had no unmerged commits and were deleted.
  - [x] 0.2.e After 0.3.c is on `main`, in each worktree run `node packages/db/scripts/test-db.mjs create yourtal_s1|s2|s3`, which drops, creates, migrates and seeds. Before 0.3.c it fails, because `atlas.sum` has no line for `20260922030000_currency_tagged_money.sql` and `seed.ts` still inserts `face_value_idr`.
  - [x] 0.2.f **Check** (after 0.2.e): all three worktrees run web and api side by side, and a migration applied in `yourtal-2` does not change `yourtal-1`'s schema.
- [x] **0.3 Unbreak HEAD: finish currency-tagged money (was YT-0513 part 2; EM-22, D1)** · needs: 0.1 — ✅ 2026-09-25 d9762ae
  - [x] 0.3.a In the `apps/api` store module, change every `*Idr` field to `*Minor` + `currency`: `listing-assembler.ts`, `drizzle-listing.repository.ts`, the DTOs and the controllers. `assembleListings` must **throw** on a row that fails `listingSchema`, not silently drop it. The `listing_price_revision` and `settlement_decrease_request` `_idr` columns move to `*_minor` + currency in a new migration. `tsc` must be clean.
  - [x] 0.3.b In `apps/web`, fix the 26 files still reading `faceValueIdr` etc. Format money with **`listing.currency`, never the viewer's region**: `store/page.tsx:36,45`, `wallet-voucher-card.tsx:66`, `store-format.ts:45`. `tsc` must be clean.
  - [x] 0.3.c `packages/db`: make `seed.ts` insert the new columns, regenerate `atlas.sum`, and confirm a fresh `yourtal_scratch` database migrates and seeds cleanly.
  - [x] 0.3.d `services/voucher`: move `db/schema.sql`, `db/query/issue.sql` and `redeem.sql` to `*_minor` + currency, and regenerate from `services/voucher` with `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)":/src -w /src sqlc/sqlc:1.31.1 generate` (Git Bash rewrites the paths without `MSYS_NO_PATHCONV`). `InsertVoucher` copies `batch.currency`. At `redeem.go:241`, compare the request currency with the voucher's and return a new `currency_mismatch` outcome that is not counted as a probe (D10). `TestSqlcSchemaMatchesTheLiveDatabase` passes against `yourtal_s1` (see 0.3.f).
  - [x] 0.3.e The voucher-keygen generates **each missing key independently**: `for k in voucher_code merchant_hmac; do [ -f /keys/$k.v1.key ] || head -c 32 /dev/urandom | od -An -vtx1 | tr -d ' \n' > /keys/$k.v1.key; done`. The existing volume already has `voucher_code.v1.key`. Today's image predates the `merchant_hmac` check, so a 200 without `--build` proves nothing (D2).
  - [x] 0.3.f **Check:**
    - `tsc` is clean in web and api.
    - In `yourtal-1`: `set -a; . ./.env; set +a; (cd services/voucher && go test -count=1 -p 1 ./...) && (cd services/ledger && go test -count=1 -p 1 ./...)` passes. Go does not read `.env`; without this the tests use the unmigrated shared database. The pricing and reward `engine_test.go` still write to `yourtal` until 0.4.b, and that is accepted.
    - After the fast-forward, from the main checkout: `pnpm db:migrate && docker compose up -d --build --force-recreate --wait voucher-keygen voucher`, then voucher `/healthz` returns 200.
- [ ] **0.4 One green gate, and tests off the dev database** · needs: 0.3 — 🔄 slot 1
  - [x] 0.4.a Add `pnpm check`: line endings, format, typecheck, lint, and the unit tests that need no services. It should finish in under 3 minutes. `pnpm verify` becomes `check` plus the database, Go and Cerbos suites.
  - [x] 0.4.b Every Go and TypeScript database suite runs against a `yourtal_test_*` database. A guard fails any test helper whose URL names a dev database; `engine_test.go:26` hard-codes one today. Once this is in, the Go tests stop writing fake AUD rates and coverage fixtures into dev data.
  - [x] 0.4.c Fix what is red today:
    - CRLF in 4 files, with `.gitattributes` `eol=lf` rules so it cannot come back;
    - the 2 files failing Format in CI;
    - the `packages/db` `seed.test.ts` idempotency failure that keeps Integration red.
  - [x] 0.4.d CI:
    - `quality.yml` runs `pnpm check`, and `integration.yml` runs the service suites;
    - remove `cancel-in-progress` for pushes to `main`;
    - `perf-budget.yml` runs on pushes to `main` that touch `apps/web/**` or `packages/ui/**`. Its comment step runs only on same-repo pull requests, and its concurrency group falls back to `github.ref`;
    - `pnpm --filter @yourtal/web test:rendered` (3.1.d) runs in `pnpm verify` and in CI, not in `pnpm check`.
  - [x] 0.4.e CI supply chain:
    - move every action to its current Node 24 major **pinned by full SHA** with a version comment: checkout v6, setup-node v6, setup-go v6, pnpm/action-setup v6, github-script v8, browser-actions/setup-chrome v2. Look up each SHA with `gh api repos/<owner>/<action>/git/ref/tags/<tag>`. The Node 20 majors also break caching ("Cache service responded with 400").
    - Set `persist-credentials: false` on every checkout.
    - Split `release.yml` into a **build** job (`contents: read`) that uploads the tarball and its checksum as an artifact, and a **publish** job (`contents: write`, `needs: build`) that only creates the release. Today a compromised dependency in `pnpm install` could publish a release that Helios installs.
    - Add a `govulncheck` step to `go.yml` for each module, add `infra/healthcheck` to its matrix and paths, and use `go-version-file`.
    - Pin `runs-on: ubuntu-24.04`, because `ubuntu-latest` moves to 26.04 on 2026-10-19.
    - CI and dev use Node 24 LTS: add `.nvmrc`, set `engines` to `>=24`, and use `node-version-file`. Check the Helios Node major in 2.1.
  - [ ] 0.4.f Diff the 14 business test-isolation files on `wip/leftovers-2026-09-22` against `main`. If they pass `pnpm verify` in `yourtal-1`, merge them; otherwise record them here as ✂️ with the reason.
  - [ ] 0.4.h Once 3.1.d adds `pnpm --filter @yourtal/web test:rendered`, run it in `pnpm verify` and in `integration.yml` (split from 0.4.d) — ⛔ 3.1.d
  - [ ] 0.4.g **Check:** every workflow is green on `main`, `pnpm check` is green in all three worktrees, and no workflow log shows a Node 20 deprecation warning.
- [x] **0.5 English by default: the quick fix (the full i18n work is 6.1)** · needs: 0.3 — ✅ 2026-09-25 3d166a2
  - [x] 0.5.a Set `DEFAULT_REGION = "AU"` in `apps/web/features/region/get-region.ts:11`, and update `region-cookie-roundtrip.test.ts`.
  - [x] 0.5.b The merchant layout's `lang` comes from the device binding's locale, defaulting to `en-AU`, instead of the hard-coded `id-ID` at `app/(merchant)/layout.tsx:44`.
  - [x] 0.5.c Make the player pass `locale` to `AccrualIndicator` and `CompletionHandoff` (`video-player.tsx:76,108`), so English sentences stop saying "1.250 poin" (EW-22).
  - [x] 0.5.d Pin a region cookie in every e2e spec that assumes ID: `earn-journey`, `redeem-journey`, `spend-journey`, `open-view-journey`, `overflow-320` (have it read the pinned locale's catalogue), `keyboard-seek`, `find-bonus-accuracy-campaign`. Afterwards `grep -l "id-ID\|DEFAULT_REGION" apps/web/e2e` lists only pinned specs.
  - [x] 0.5.e **Check:** a fresh browser with no cookies sees English and AUD at `/`, and `/id` is still Indonesian. Verified 2026-09-25: `/` is `lang=en-AU` and all English (it shows no amounts), `/id` is Indonesian. `/store` still lists the ID-only mock catalogue in Rupiah to an AU visitor; that is 6.6.a (region-scoped store).
- [x] **0.6 Retire the old story in the docs** · needs: 0.1 — ✅ 2026-09-25 3a097c2
  - [x] 0.6.a `README.md`: remove the remaining false claims ("under 300 lines, enforced in CI"; the "six things" section's "Run the pilot before writing any code").
  - [x] 0.6.b Add a "Superseded by TASKS.md (2026-09-25)" banner to `docs/04-roadmap.md`. Add rows to `docs/16` for every **F** answer above and for each of these:
    - video-first social UI (it supersedes the board layout in docs/17 §1, while docs/17 §1.2's "do not copy" rules still hold);
    - self-hosted HLS through an ffmpeg worker, replacing Cloudflare Stream;
    - no user-to-user interaction anywhere on the platform (see Phase 3);
    - B4 (24 → no expiry by default), K2 (IDR 8 → 9) and docs/18 §1 ("IDR in sen") superseded.
  - [x] 0.6.c Bring `docs/24` and `docs/25` from `wip/leftovers-2026-09-22` onto `main`, and amend them to match F2: no expiry by default, Helios acceptable for production.
  - [x] 0.6.d **Check:** no document still describes Indonesia-first, Zitadel, phone OTP, 24-month expiry or IDR-in-sen as current.
- [ ] **0.7 IDR in whole Rupiah (decision T-1): a data migration, not a constant** · needs: 0.3 — 🔄 slot 1
  - [x] 0.7.a Add a migration that divides IDR amounts by 100 where `currency = 'IDR'`. It covers `store.listings`, `voucher.vouchers`, `store.listing_price_revision`, `store.settlement_decrease_request`, and every ledger entry, allocation, purchase and pricing-rate row. The ID rates become micros per point: B = 6_000_000, P_issue = 9_000_000.
  - [x] 0.7.b `MINOR_UNIT.IDR` becomes exponent 0.
    - Remove `SEN_PER_RUPIAH`; `rupiah(n)` scales by `10^exponent` (= 1).
    - Rename `MOCK_BACKING_RATE_IDR_SEN_PER_POINT` to `…_IDR_PER_POINT = 6`, until 4.9 deletes it.
    - `pointsPriceFromSettlement` rounds **up** (EM-20).
    - Unify `MAX_SAFE_AMOUNT_MINOR` into one constant.
  - [ ] 0.7.c Convert every IDR literal from sen to Rupiah across contracts mocks, `apps/web` fixtures, the seed, and Go ledger and voucher tests (and the `price_test.go` comments). Remove the IDR defaults and fallbacks from `packages/drivers` (`payments.ts:122,194`, `disbursement.ts:69`, `declaredMinorUnitExponent`).
  - [ ] 0.7.d **Check:** a seeded listing with S = Rp 54,000 stores 54000, shows face value "Rp54.000", and costs 9,000 pts.
- [ ] **0.8 Clean stack: security fixes now, latest versions once the gate is green** · needs: 0.1 (0.8.f needs 0.4) — 🔄 A
  - [x] 0.8.a npm advisories (GitHub dependency graph and `pnpm audit`, 7 found):
    - remove the stale `@lhci/cli` devDependency, which carries 6 of them (extract-zip, tmp, uuid), and run it through `pnpm dlx @lhci/cli@0.15.1` in `perf-budget.yml`;
    - override `browserslist@<4.28.7` → 4.29.0, since `@serwist/next` pins the vulnerable 4.28.6 (prod);
    - remove the unused `@tanstack/react-query` and `@hookform/resolvers`.
  - [x] 0.8.b pnpm 11.3.0 → 11.27.1 (`packageManager`). 18 pnpm advisories, including an `allowBuilds` bypass. Declare `minimumReleaseAge: 1440` explicitly and delete the stale `minimumReleaseAgeExclude` list. Locally, pnpm switches itself from the `packageManager` field; Helios gets 11.27.1 in 2.1.b.
  - [x] 0.8.c Go, in both services:
    - chi 5.2.4 → 5.3.2, three reachable IP-spoofing GHSAs;
    - `router.Use(middleware.RealIP)` → `middleware.ClientIPFromRemoteAddr`, because the bump alone leaves RealIP spoofable;
    - x/text 0.29.0 → 0.42.0 (a reachable GHSA) and x/sync 0.17.0 → 0.23.0;
    - `toolchain go1.26.8` in every `go.mod` (under 1.26.5, 5 reachable stdlib CVEs), and Dockerfile builders on `golang:1.26.8-alpine3.24`;
    - `govulncheck ./...` reports nothing.
  - [x] 0.8.d Containers:
    - `quay.io/minio/minio:latest` can no longer be pulled, and upstream is archived with unpatched critical CVEs. Replace it with the maintained fork `pgsty/minio`, pinned by digest, in compose and `integration.yml`.
    - Remove Zitadel (critical CVE, unused).
    - Tag the distroless runtime (`static-debian12:nonroot@…`) so Dependabot can track it.
  - [x] 0.8.e `.github/dependabot.yml`: npm, gomod (both services and the contracts Go module), docker, docker-compose and github-actions. Weekly and grouped, with a 7-day cooldown so it never proposes what `minimumReleaseAge` refuses.
  - [ ] 0.8.f Latest versions, after 0.4 is green:
    - next and `@next/*` 16.3.6; next-intl 4.14.6 or later; `@nestjs/*` 12.1.0; drizzle-orm 0.45.3; pg-boss 12.34.0; `@aws-sdk/client-s3`; lucide-react 1.48.0; jsdom 30.1.1; turbo 2.11.3 or later; typescript-eslint 8.70.1; prettier 3.9.9 (then run format); knip 6.38.0;
    - pin `postgres:17.11`, `valkey:8.1.10`, cerbos 0.55.0 and alpine 3.24 by digest;
    - atlas: pin `1.3.3`, the real version (the current pin is a mislabelled canary);
    - the contracts Go module to 1.26, and openapi-generator v7.25.0 (regenerate and commit).
    
    Run `pnpm verify` after each group.
  - [ ] 0.8.g Schedule the majors, each as its own task once the plan is green:
    - TypeScript 6.0.3 (7.x breaks typescript-eslint);
    - web-vitals 6;
    - Go 1.27;
    - Postgres 18 (PGDATA path change, needs a dump and restore);
    - Valkey 9;
    - pnpm 12;
    - drop the browserslist override once serwist 10 is released.
  - [x] 0.8.h Hygiene:
    - `.gitignore` gets `.env.*` with `!.env.example`, the Go binaries (`services/*/voucher`, `infra/healthcheck/healthcheck`, `*.exe`), `*.log`, `blob-report/`, `playwright/.cache/`, `.eslintcache`, `/bundle-report.md`, and Windows and editor files;
    - replace the literal NUL bytes in `packages/idempotency/src/key.ts` and `scripts/check-line-endings.mjs` with `\0` escapes;
    - mark the voucher sqlcgen as linguist-generated.
  - [ ] 0.8.i Hygiene that touches other areas' files, done in their tasks:
    - (requested by A) C: test data uses `kopikenangan.example`, never the real `kopikenangan.id` (6 files);
    - (requested by A) C: `packages/media/src/hls-origin.ts:103` fails closed outside dev, instead of falling back to `yourtal_local_only`;
    - add `services/{ledger,voucher}/.dockerignore`;
    - add a `sqlc diff` step to CI;
    - delete the dead `.npmrc` keys that pnpm 11 ignores.
  - [ ] 0.8.j **Check:**
    - `pnpm audit` and `govulncheck` report nothing;
    - GitHub's dependency graph shows none of the versions with advisories;
    - `docker compose pull` succeeds;
    - `git ls-files` contains no build output, env file or binary.

**Done when:** `main` compiles and every CI workflow is green; three worktrees run side by side on their own data; a first-time visitor gets English and AUD; IDR amounts are whole Rupiah everywhere.

## Phase 1 — Identity, contracts & plumbing · Area A · ~4d

Everything else depends on knowing who is calling, and on a shared shape everyone builds against. Today the API builds identity from `x-yt-user-id` / `x-yt-business-roles` headers that anyone can send (`principal.service.ts:70-85`, EW-02), and the web app has no login. **Do 1.1 to 1.3 first:** they publish the contracts, columns and fakes that let B and C build before Phase 4 lands.

- [ ] **1.1 Shared contracts and columns** · needs: 0.7
  - [ ] 1.1.a Campaign contract: `businessId`, `region`, `audience`, `contentCategory`, `posterUrl`, `teaserUrl` (a progressive MP4), `hlsUrl`, `captionsUrl`, `durationSeconds`, `aspect`, `estimatedBytes`, `startsAt`, `endsAt`, `openViewing` (default false), `teaserStartSeconds`. Listing contract: `region`, `audience`, `contentCategory`, `imageUrl`, `channel` (`in_store` | `online` | `both`), `partialRedemption` (`single_use` | `balance_carries`). Business contract: `region` (immutable), `currency`, `handle`, `logoUrl`, `coverUrl`.
  - [ ] 1.1.b **In the same commit**, a migration adds every one of those columns (campaign `business_id` etc.; listing; business), updates the Drizzle tables and the seed, and keeps `schema-drift.test.ts` green. Today no contract has an image field, which is why every card is text-only.
  - [ ] 1.1.c **Audience rules**, the one definition everyone uses:
    - `all_ages` reaches every account.
    - `teen` reaches only accounts aged 13–17.
    - `adult` reaches only 18+.
    - `parents` reaches 18+, boosted for accounts that have declared the parent-of-young-children interest and given ad-targeting consent.
    - **Adults** see all_ages, adult and parents. **Teens** see all_ages and teen, with teen items boosted.
    - Until 12.x, non-adult accounts do not exist (the `TEEN_ACCOUNTS` flag is off).
  - [ ] 1.1.d Category policy, one source in `packages/jurisdiction`: `categoryPolicy[region][contentCategory] = allowed | adult_only | prohibited`.
    - AU prohibited: tobacco, vaping.
    - ID prohibited: gambling, tobacco, vaping.
    - adult_only in both regions: alcohol, dating, financial products, weight loss, cosmetic procedures, energy drinks, plus gambling in AU.
    - The `contentCategory` values are: food-and-drink, fashion, personal-care, electronics, telco, transport, fitness, education, travel, home, entertainment, games, books, family, toys, digital-goods, services, and the restricted categories above.
    - Keep `listingCategorySchema` as it is.
  - [ ] 1.1.e Interest taxonomy v2:
    - add `family-young-children` ("Parent of young children"), declared only and never derived from receipts;
    - add "expecting" and "baby-bump" to `BLOCKED_INTEREST_TERMS`;
    - bump `INTEREST_TAXONOMY_VERSION`;
    - a test fails if any entry is sensitive (health, religion, ethnicity, sexuality, politics, financial hardship), which keeps red line 6.
  - [ ] 1.1.f `questionsAskedFor(d)` in `question-bank.ts` implements F10 (`d < 60` → 0, otherwise `max(1, min(5, floor(d/300)))`). The 1.1.b migration also adds `campaign.terms_version.accuracy_bonus_points`, a CHECK that questions asked ≤ 5, and a required `answerable_after_seconds` on questions.
  - [ ] 1.1.h A listing's `currency` comes from its business's region on the server. Until then, `POST /api/:tenantId/store/listings` takes it in the body (0.3.a); remove that field then.
  - [ ] 1.1.g **Check:** contracts and migrations land together and `pnpm check` is green.
- [ ] **1.2 Internal ledger and voucher contracts, with fakes that behave like the real thing** · needs: 1.1
  - [ ] 1.2.a `ledger-internal` covers:
    - **pricing:** `quote` and `lockQuote`; `priceListing(listingId, S, currency)`; `quotePurchase(points, region)`;
    - **funding and allocations:** `purchasePoints`; `listAllocations(businessId)` and `getAllocation`; allocation `hold` / `consume` / `release` / `returnGrant`; `campaignSpend(campaignId)`;
    - **earning and spending:** `grantReward` (campaign); `grantAction` (streak, receipt or goodwill, marketing-funded); `burnForVoucher` and `getBurn(sagaId)`; `reinstateBurn(sagaId)` (K13);
    - **users:** `escrow` and `releaseEscrow`; `balance` (available, pending with unlock dates, expiring) and `history` (each entry carries kind, externalRef and the campaign, listing or voucher it belongs to);
    - **economy:** `coverage(region)` and `economyDaily(region, from, to)`; `proposeRate` and `approveRate`; `fundMarketing`; `statements` and `approvePayout`.
  - [ ] 1.2.b `voucher-internal` covers:
    - `requestBatch` and `approveBatch`;
    - `reserve(listing, sagaId)`, `release(sagaId)` and `activate(sagaId)`;
    - `reveal` (owner only) and `qrToken` / `verifyQrToken`;
    - `listForUser` and `get`;
    - `authorizeAsDevice` / `captureAsDevice`, which assert merchant and device;
    - `setKillSwitch` and `listKillSwitches`;
    - `issueMerchantCredential`, `rotate` and `revoke`;
    - `merchantCaptureStats(merchantId, from, to)`.
  - [ ] 1.2.c A **closed error enum** shared by both contracts: `insufficient_available`, `quote_expired`, `allocation_exhausted`, `campaign_cap_reached`, `velocity_capped`, `solvency_blocked`, `region_mismatch`, `audience_blocked`, `already_granted`, `idempotency_conflict`, `kill_switch`, `currency_mismatch`.
  - [ ] 1.2.d `apps/api/src/shared/{ledger,voucher}-client`: an **HTTP** implementation plus a **fake** that implements the *semantics*, stored in `platform.ledger_fake_*` tables so api and worker share state:
    - grants go to pending with an unlock time by tier;
    - burns draw from available only;
    - the same idempotency key with a different body returns 409;
    - quotes are `ceil(S × 1e6 / B)` with the F1/F12 rates and expire after 15 minutes;
    - allocations and campaign caps run out.
    
    `LEDGER_MODE=fake|live` switches between them. `fake` is refused when `APP_ENV=staging` once 4.9 is merged. Until 10.1, `statements` and `approvePayout` return `not_implemented`.
  - [ ] 1.2.e `ledger-client.contract.spec.ts` and `voucher-client.contract.spec.ts` run against the fake in `pnpm check` and against the live services in 4.1 and 4.5.
  - [ ] 1.2.f **Per-region settings (F12)**, owned by A together with the `platform_setting` policy:
    - the table `platform.region_setting(region, key, value, set_by, approved_by, effective_from)`, seeded with every F12 default plus `points_expiry` = off (`inactivity_months` = 12 when on);
    - apps/api reads it through `apps/api/src/shared/settings` (`getSetting(region, key)`, cached for at most 60 s);
    - the ledger reads its own keys (caps, holdback, coverage thresholds, marketing limits) through a view granted to `yourtal_ledger`;
    - `ledger-internal` gains `getSettings(region)`, `proposeSetting` and `approveSetting` (two-person) for 9.5.d.
  - [ ] 1.2.g **Check:** B and C can call every operation above against the fake from a test, and `getSetting('AU', 'daily_earn_cap')` returns 500.
- [ ] **1.3 Plumbing for parallel phase sessions** · needs: 1.1
  - [ ] 1.3.a Add `"./*": "./src/*.ts"` to the contracts package's exports, so nobody edits the exports map again. Split `openapi/route-registry.ts` into `route-registry.{a,b,c}.ts`, concatenated. Make `route-drift.test.ts` discover the modules and assert registry ⇔ live equality, instead of hard-coded route counts.
  - [ ] 1.3.b Split `packages/db/src/seed.ts` into `seed/{identity,ledger,watch,studio,store}.ts`, with `seed.ts` importing them.
  - [ ] 1.3.c Create `apps/worker`: a pg-boss runner (`packages/queue`) that **auto-loads** every `src/jobs/*.ts` exporting `job`, with no central list. Add ffmpeg to the Helios host prerequisites (`infra/HELIOS.md`).
  - [ ] 1.3.d `apps/api/src/shared/testing/session-for.ts` (register + login → cookie) for everyone's tests. Until 1.5.a lands it **also returns the matching `x-yt-*` headers**, so a test passes both before and after 1.5.a. The boot tests move onto it in 1.5.a.
  - [ ] 1.3.e **Check:** a new job file is picked up without editing any other file, and a new route passes route-drift once it is added to its area's registry.
- [ ] **1.4 Accounts and profile** · needs: 1.1
  - [ ] 1.4.a Add a migration for `identity.user_profile` with these fields:
    - `region` AU | ID, immutable after signup;
    - `display_locale`, defaulting to `en-AU` and independent of region;
    - `display_name`, `date_of_birth`, `timezone` (the browser's IANA zone);
    - `guardian_email` and `parent_consent_status`;
    - `trust_tier` 0–3, `suspended_at`.
    
    `age_band` is **computed when read** from the date of birth, never stored.
  - [ ] 1.4.b Age policy in `packages/jurisdiction`: add `minimumAgeWithParentalConsentYears: 13` beside `minimumAgeYears: 18`, keeping the strict schema defaults (21 / 21). Add a `TEEN_ACCOUNTS` flag to `apps/api/src/config`, **default false everywhere**; only 12.1 switches it on for staging.
    - Flag off: refuse under 18.
    - Flag on: 13–17 require `guardianEmail` and get `pending`.
    - Under 13: a neutral "You can't create an account yet", with no age stated, the date of birth discarded, and a 24 h cookie blocking retry.
    
    Update `policy-query.test.ts`.
  - [ ] 1.4.c `POST /api/auth/register` takes region, locale, display name, date of birth, timezone and, when needed, guardian email. It returns a session.
  - [ ] 1.4.d `apps/api/src/modules/identity/me.controller.ts` provides `GET /api/me` (profile, age band, business memberships, staff roles) and `PATCH /api/me` (display name, locale). These are root routes only; B's `me` module owns the sub-routes and C's `business` module owns `/api/me/businesses`.
  - [ ] 1.4.e Email verification actually stores `verified_at`. Today it stores nothing (`auth.service.ts:284-308`).
  - [ ] 1.4.f (requested by B for 5.4.b) DSAR handlers for `identity.user_profile`, credentials and sessions, registered with `dsar-orchestrator`.
  - [ ] 1.4.g **Check:** register → `GET /api/me` shows region AU, locale en-AU and age band adult. With the flag off, a 15-year-old is refused.
- [ ] **1.5 The principal comes from the session, never from headers** · needs: 1.4
  - [ ] 1.5.a `PrincipalService.resolve` reads the `yt_session` httpOnly cookie (or Bearer token) through `SessionService.validateAndTouch`. **Delete every `x-yt-*` header path**, and remove the refusal to boot when `NODE_ENV=production`. **In the same commit** (exempt), remove the header fallback from `session-for.ts` and move every boot test in every area that still sends raw `x-yt-*` headers onto it.
  - [ ] 1.5.b The principal carries:
    - business roles from `business.business_members`, only where `joined_at` is set;
    - staff roles from a new `identity.staff_role` table, with the roles in `packages/authz/src/roles.ts`;
    - `region` from the profile;
    - `ageBand`;
    - suspension from the database.
    
    Cerbos policies compare the principal's region with the resource's region on every resource (the F2 hard walls). (requested by C for 9.1) `pnpm staff:add <email> <role>` writes `identity.staff_role`.
  - [ ] 1.5.c Add a `store_device` principal resolver that calls a `DeviceCredentialVerifier` port in `apps/api/src/shared`. Until C's devices module implements the port (8.1.b), it returns a clear 401.
  - [ ] 1.5.d `PdpGuard` gets an async resource-attribute loader, so resources send `campaignId`, state, `region`, `audience` and `openViewing` (EW-03). Add one guard-to-real-Cerbos integration test per module.
  - [ ] 1.5.e HTTP hardening:
    - Fastify `trustProxy`;
    - cookies Secure (except in dev), HttpOnly and SameSite=Lax;
    - session lifetimes from F12.
  - [ ] 1.5.f Stop storing token-bearing responses in `platform.idempotency` (`auth.controller.ts:107,132`). Make the throttle atomic (`SET NX EX`), removing its check-then-act race.
  - [ ] 1.5.g **Check:**
    - a call with `x-yt-user-id` and no session gets 401;
    - an ID principal reading an AU campaign is denied;
    - the route suites pass against real Cerbos.
- [ ] **1.6 Simulated email you can read** · needs: 1.4
  - [ ] 1.6.a Add an `email` boundary to `packages/drivers`. The simulated driver stores messages in `platform.sim_outbox`. `AuthService.deliver` uses it for verification, reset and invitation emails.
  - [ ] 1.6.b `GET /api/dev/inbox` and a plain `/dev/inbox` page. They are enabled only when `APP_ENV` is `dev` or `staging`.
  - [ ] 1.6.c (requested by B and C) `push` and `webhook` boundaries in `packages/drivers`, with simulated drivers that store to `platform.sim_outbox`.
  - [ ] 1.6.d **Check:** register → the verification email appears in `/dev/inbox` → its link verifies the account.
- [ ] **1.7 Web ↔ API plumbing** · needs: 1.5
  - [ ] 1.7.a `apps/web/lib/api/`: a server-only `apiFetch(path, zodSchema)` that calls `API_INTERNAL_URL`, forwards `yt_session` and returns typed errors. Per-domain calls live in each area's `features/<x>/<x>-api.ts`.
  - [ ] 1.7.b The login and `PATCH /api/me` Server Actions set the `yt_session`, `yt_locale` and `yt_region` cookies. `proxy.ts` reads only those cookies and defaults to AU / en-AU. (requested by A) B makes `i18n/request.ts` read only `yt_locale` and `yt_region`, defaulting to en-AU, under 6.1.b.
  - [ ] 1.7.c `apps/web/proxy.ts` protects these exact prefixes, redirecting to `/login?returnTo=`: `/home`, `/watch`, `/campaign`, `/store`, `/wallet`, `/me`, `/onboarding`, `/quick`, `/business`, `/studio`, `/staff`. Everything else stays public, with these exceptions for the merchant counter:
    - `/merchant/pair` is public;
    - `/merchant/**` also passes with a `yt_device` cookie (the 8.1 device credential), which the page and the BFF verify on the server through the 1.5.c resolver;
    - there is never an open fallback.

    Redirects come from `apps/web/route-redirects.ts`, which starts empty; each area adds its own lines.
  - [ ] 1.7.d (requested by B) In `money-format.ts`, add `formatPointsIn(locale, amount)` with no default, change `formatPoints`'s default to `en-AU` and mark it deprecated. B and C move their own call sites (6.1.c, 7.8.c, 8.2.d).
  - [ ] 1.7.e **Check:** a Server Component shows the signed-in user's name through `apiFetch`, and `/wallet` without a session redirects to `/login`.

**Done when:** you can register, verify through the simulated inbox, log in and see your name; no `x-yt-*` header is accepted anywhere; a principal can never read another region's data; B and C are building against the contracts and fakes.

## Phase 2 — Staging on Helios · Area A · ~2.5d

Deploy early. After this phase every merge to `main` goes to staging within minutes, so the founder can watch progress live. Mechanically, Helios's poller follows gaiada-deploy's `production` channel. "Staging" is the posture we give it: banner, demo data, simulated drivers, `noindex`.

- [ ] **2.1 The whole stack runs on Helios** · needs: 1.3
  - [ ] 2.1.a Deploy targets:
    - add `yourtal-api` and `yourtal-worker` in `gaiada-setups/_data/deploy-registry.yml`, run `tools/sync-deploy-config.py`, and commit the regenerated `.gaiadeploy.yml`;
    - reach the box with `ssh helios-w`, as described in `gaiada-setups/access/`;
    - Postgres (the existing container on 26432), Valkey, Cerbos, MinIO, ledger and voucher run through `docker-compose.helios.yml` plus a systemd unit;
    - record the layout in `infra/HELIOS.md`.
  - [ ] 2.1.b Give `apps/api` and `apps/worker` a real build (tsc → `dist`). Helios runs pnpm 11.27.1 and the same Node major as CI (0.4.e). The release artifact contains web standalone, api `dist`, worker `dist` and migrations. The deploy runs `atlas migrate apply` **before** reloading the apps, and a migration error fails the deploy.
  - [ ] 2.1.c nginx, only in the `yourtal.gaiada.com` CloudPanel vhost, with `nginx -t` before any reload:
    - `/api` goes to the API;
    - `/media/posters`, `/media/teasers` and `/media/captions` are public from MinIO;
    - **`/media/hls/` requires a per-session signature** (`secure_link`), as used by 5.1.d (EW-18);
    - HSTS and CSP.
  - [ ] 2.1.d Secrets:
    - `/opt/yourtal/secrets/app.env` (mode 0600), never in the artifact;
    - generate the voucher keyring once into `/opt/yourtal/secrets/keyring`, mounted read-only;
    - after migrating, the deploy sets the `yourtal_app`, `yourtal_ledger`, `yourtal_voucher` and `yourtal_analyst` role passwords from `app.env` (`ALTER ROLE … PASSWORD`), because the repo is public (F6) and the migrations hard-code local passwords.
  - [ ] 2.1.e **Check:**
    - on Helios, `curl 127.0.0.1:<api>/api/health` returns 200;
    - ledger and voucher `/healthz` return 200;
    - `ss -ltnp` shows every YourTal port on 127.0.0.1.
- [ ] **2.2 Continuous deploy from main** · needs: 2.1
  - [ ] 2.2.a `release.yml` triggers on pushes to `main`, gated by `pnpm check` and the build. It publishes the `deploy/production-*` release that the poller installs. It keeps `paths-ignore: TASKS.md`.
  - [ ] 2.2.b The shared `gaiada-deploy` rollback loses `PM2_NAME` (old YT-0532). Fix it upstream in `deploy-workflows` if we can reach it. Otherwise document "rollback = redeploy the previous tag" and exercise it once.
  - [ ] 2.2.c Add a daily check that the deployed SHA equals `main`, so a poller that has silently stopped gets noticed (old YT-0566).
  - [ ] 2.2.d **Check:** a trivial commit pushed to `main` is live on staging within about 5 minutes.
- [ ] **2.3 Staging posture and review tools** · needs: 2.2
  - [ ] 2.3.a With `APP_ENV=staging`:
    - `X-Robots-Tag: noindex` from nginx and the proxy;
    - `/dev/inbox` enabled;
    - B's 3.1.f renders `<StagingBanner/>` ("Staging — demo data, payments simulated"), and B's `robots.ts` disallows everything.
  - [ ] 2.3.b Boot assertion: `APP_ENV=staging` refuses to start unless every driver is simulated.
  - [ ] 2.3.c Nightly `pg_dump` **plus the keyring** to `/opt/yourtal/backups`, kept 7 days. Rehearse one restore that decrypts a stored voucher code (old YT-0531).
  - [ ] 2.3.d `/dev/clock`, on staging only and audited, so a reviewer can walk time-based journeys in one sitting:
    - "Release my pending points now";
    - "Run job now" for every scheduled job (holdback release, expiry, settlement accrual, weekly statement, payout, solvency, proof);
    - "Advance my account by N days".
  - [ ] 2.3.e A minimal seed when the database is empty: snap-app in AU and in ID, 2 campaigns each using the 30 s fixture video, one demo login per role, and one tier-0 demo viewer seeded with a pending grant through the 1.2 fake. The full demo world is 13.1.
  - [ ] 2.3.f **Check:** staging shows the banner, a reviewer can log in with a demo account, and `/dev/clock` releases the tier-0 viewer's pending points.

**Done when:** every merge to `main` is live on staging within minutes, with the API, both Go services and the datastores running on Helios, backed up nightly.

## Phase 3 — Design language · Area B · ~6d

**Direction (founder, 2026-09-25): video-first social.** Think YouTube, TikTok and Instagram, with YouTube's model inverted: here **the viewer is the one who is rewarded**. It should feel native to Gen Z and Gen Alpha (fast, visual, playful, rewarding) and still be clear for older viewers, with legible type, obvious actions and honest numbers. The hooks are the feed and the moment points land. What is broken today is detailed in `docs/audit/2026-09-25/ui-design.md`.

**Rules for the whole platform, every account:**

- **No user-to-user interaction:** no comments, direct messages, public profiles, public like or view counts, leaderboards or user uploads. This is what keeps YourTal outside Australia's under-16 social media minimum age, whatever the teen settings.
- **Never autoplay into another campaign or reward session.**
- **Copy says "earn points" and "rewards"**, never "get paid", "money", "income", "cash" or "salary".
- **No claims about redemption rates, return on investment or breakage** (red line 5).

- [ ] **3.1 Fix the CSS pipeline first (half a day; fixes dialogs and badges immediately)** · needs: 0.2.b
  - [ ] 3.1.a Add `@source "../../../packages/ui/src";` after the Tailwind import in `apps/web/app/globals.css`. Today 57 `packages/ui` classes are never compiled, which is why Dialog opens at `top: 1596px` on an 800 px screen.
  - [ ] 3.1.b Add a base layer: `html { color-scheme }` and body background, text colour and font from the tokens.
  - [ ] 3.1.c Rewrite `select.tsx:48` in Tailwind v4 syntax.
  - [ ] 3.1.d A rendered-output gate, run as `pnpm --filter @yourtal/web test:rendered` (A adds it to `pnpm verify` and CI in 0.4.d):
    - a spec that opens a Dialog and asserts it sits inside the viewport;
    - axe color-contrast in both themes, on 6 routes that stay public after 1.7.c (`/`, `/id`, `/login` and the `(lab)` pages);
    - a check that no `packages/ui` class is missing from the built CSS.

    `next build` fails until 0.3 is on `main`, so do 3.1.d and 3.1.g after rebasing past 0.3; check 3.1.a–c with `next dev`.
  - [ ] 3.1.e `i18n/request.ts` loads every `messages/<locale>/*.json` that exists, with no hard-coded list, and the parity test globs the same way. Then C can add its own catalogues without touching B's files.
  - [ ] 3.1.f (requested by A for 2.3.a) `RootDocument` renders `<StagingBanner/>` when `APP_ENV=staging`, and `robots.ts` disallows everything there.
  - [ ] 3.1.g **Check:** the team invite dialog is visible and usable, axe is clean on the gate's routes, and the banner shows with `APP_ENV=staging`.
- [ ] **3.2 Two prototypes, and the founder picks one (F3)** · needs: 0.2.b
  - [ ] 3.2.a Media: `apps/web/app/(lab)/lab/fetch-media.mjs` downloads 6 vertical and 2 horizontal Pexels clips into `apps/web/public/lab-media/` (gitignored), with each clip's URL and licence in `CREDITS.txt`.
  - [ ] 3.2.b Build the same flow in `(lab)/lab/` with mock data, excluded from the production build:
    - the For You feed: vertical teasers autoplaying, a swipe;
    - a Quick campaign earning inside the feed;
    - the long-form player, with a question appearing mid-video and the earn moment;
    - the store as a shoppable grid;
    - the wallet, with each voucher as a pass with a QR code.
  - [ ] 3.2.c **Variant "After Dark"**: immersive, like TikTok.
    - The UI is overlaid on full-bleed video, with a right-rail of actions.
    - Dark-first: canvas `#0B0B0F`, surface `#17171F`, text `#F5F5F7`, accent `#FF3D6E`.
    - Its light theme is defined too.
    - Type: Bricolage Grotesque 700–800 for display, Figtree for body, JetBrains Mono for codes.
  - [ ] 3.2.d **Variant "Daylight"**: framed, like Instagram and YouTube.
    - The UI sits below the media, on cards.
    - Light-first: canvas `#FFFFFF`, surface `#F4F4F7`, text `#0E0E12`, accent `#5B2EFF`, streak `#FF7A59`.
    - Its dark theme is defined too.
    - Same fonts as After Dark.
  - [ ] 3.2.e Shared by both variants:
    - **one PointsChip**: a gold fill (`#FFC53D` / `#FFB400`) with dark text, and gold is never used as text colour on a light surface;
    - the **earn moment**: a coin burst lands on a "+N pending · unlocks <date>" badge beside the balance chip, and the chip counts **available** points only;
    - a streak flame (there is no level ring, because the trust tier is never shown);
    - a channel avatar;
    - captions on by default when muted;
    - a scrim behind any text laid over video;
    - tap pauses; under reduced motion there is no autoplay;
    - fonts through `next/font`.
  - [ ] 3.2.f Deliver to the founder:
    - Playwright `recordVideo` captures at 390×844 of a scripted 30 s run for each variant (swipe 3 items, in-feed earn, open a campaign, a question appears, the earn moment, the store, the wallet pass), saved to `docs/audit/2026-09-25/lab/`;
    - F3 asked with options.
  - [ ] 3.2.g **Check:** F3 is answered, or it defaults to After Dark 24 h after 3.2.f.
- [ ] **3.3 Tokens v2** · needs: F3
  - [ ] 3.3.a Rewrite `packages/ui/src/styles/tokens.css` in three tiers (raw → semantic → component), using the token names in `ui-design.md` §5 D1:
    - surfaces: `canvas`, `surface`, `surface-sunken`, `overlay`;
    - text: `fg`, `fg-muted`, `fg-subtle`, `fg-on-accent`, `fg-on-points`;
    - borders: `border-subtle`, `border-control`, `border-strong`;
    - accent and `points`;
    - status colours as `-solid`, `-subtle` and `-on-subtle`;
    - `focus`;
    - type roles from `display-lg` down to `caption` (12 px minimum), plus tabular numerals;
    - layout widths; controls at 44 px (default), 36 px (console) and 56 px (counter); radii; three elevations;
    - motion at 120 / 200 / 320 ms with a reduced-motion reset; z-index layers.
    
    Light and dark are both defined from the picked variant.
  - [ ] 3.3.b Three themes from one token set: **viewer** (the picked variant), **studio** (desaturated and dense) and **counter** (maximum contrast, 56 px targets).
  - [ ] 3.3.c Rewrite `contrast.test.ts` for the new pairs. Lint bans `text-[Npx]` and raw hex colours, **in B's `features/**` directories only**; C turns the same rules on for its own in 7.8.
  - [ ] 3.3.d Delete `(lab)` except the gallery (3.6).
  - [ ] 3.3.e **Check:** the contrast suite passes in both themes, and a raw hex colour in `features/player` fails lint.
- [ ] **3.4 Primitives, without breaking C** · needs: 3.3
  - [ ] 3.4.a Rework: Button (primary / secondary / ghost / danger / link; sm / md / lg / counter; loading; icon), Input, Textarea, NativeSelect, Card, StatusBadge, Dialog, BottomSheet, Toast with its provider, Tabs, Skeleton, Progress. **Keep every existing export name and prop.** New variants are additive; old ones stay as aliases until C finishes 7.8 and 8.2.
  - [ ] 3.4.b New: Heading, Text, PageContainer, PageHeader, Section, **PointsChip**, MoneyAmount (the currency comes from the data, never the viewer), KeyValue, DataTable (becomes a card list below `md`), EmptyState, ErrorState, Notice, Switch, Chip, SegmentedControl, ChoiceCard, ChannelAvatar (with an initials fallback), **MediaCard** (16:9 and 9:16, with poster, duration and progress), QRPanel, Stepper, FilterBar, ListRow.
  - [ ] 3.4.c **Check:** the console and merchant screens still compile and render, and every primitive is in the gallery (3.6).
- [ ] **3.5 Video primitives and shells** · needs: 3.4
  - [ ] 3.5.a **VerticalFeed**, with `mode: "teaser" | "inline-session"`:
    - native `<video>` for the MP4 teasers;
    - at most 3 video elements mounted; the rest are posters;
    - preload the next item's first 300 KB only when not on cellular and `saveData` is false;
    - it ends with "You're all caught up".
  - [ ] 3.5.b **VideoSurface**:
    - hls.js is imported dynamically, only on the watch page;
    - starts at 360p on cellular and 540p otherwise, never above 720p unless the viewer chooses;
    - a real error state; a CC toggle.
  - [ ] 3.5.c Shells:
    - **ViewerShell**: top bar with logo, search field and the available-points chip; bottom nav on mobile (Home · Watch · Store · Wallet · Me); side nav from 1024 px; the staging banner slot;
    - **StudioShell**: desktop sidebar, used for business and staff;
    - **CounterShell** for the merchant;
    - the public header and footer.
    
    (requested by C) Remove the business tab from the viewer shell.
  - [ ] 3.5.d Move `(app)/page.tsx` to `(app)/home/page.tsx`. In the same merge, add these to `route-redirects.ts`: `/` → `/home` when signed in, and `/` → `/au` when signed out, until 11.1.a.
  - [ ] 3.5.e **Check:** the feed holds at most 3 `<video>` elements after scrolling 20 items, and nothing links to `/business` from the viewer shell.
- [ ] **3.6 Brand, gallery and visual tests** · needs: 3.4
  - [ ] 3.6.a Brand: the wordmark "YourTal" in Bricolage Grotesque 800, with the points coin glyph as the mark. Favicon, maskable icons and the web manifest. Today `/favicon.ico` returns 404.
  - [ ] 3.6.b A gallery at `(lab)/lab/ui`, with Playwright `toHaveScreenshot` baselines for every primitive at 390 px and 1280 px, light and dark. `pnpm test:visual` runs inside `mcr.microsoft.com/playwright:<installed version>-noble` for both generating and comparing, and the snapshot path has no platform suffix, so baselines made on Windows match CI on Linux.
  - [ ] 3.6.c Lint in B's `features/**`: ban raw `<button>`, `<select>`, `<table>` and `<input>`, and ban JSX string literals. Warn for now; it becomes an error in 6.1.
  - [ ] 3.6.d **Check:** `pnpm test:visual` passes locally and in CI.

**Done when:** the founder has picked a variant from real motion captures, and every primitive, video component and shell exists in the gallery in light and dark at phone and desktop widths.

## Phase 4 — The bank is correct · Area A · ~9d

The money engines are sound libraries with **confirmed defects and no callers**. Fix each defect with a regression test that fails on the audit's scenario first, then expose the engines. Defect IDs point into `docs/audit/2026-09-25/`: `engine-money.md` (EM-), `engine-voucher.md` (D) and `engine-watch.md` (EW-). The order below is chosen to replace B's and C's fakes as early as possible. **The regions are separate economies** (F2): every account, rate, allocation, reserve and voucher is region-scoped, and the ledger refuses anything that crosses.

- [ ] **4.1 Ledger internal API (was YT-0593; EM-03)** · needs: 1.2
  - [ ] 4.1.a Service authentication for loopback calls. Each caller (api, worker) signs method, path, body and timestamp with an HMAC shared secret. Reject more than 60 s of skew, and keep a replay cache.
  - [ ] 4.1.b Replace the four 501 routes (`services/ledger/internal/api/routes.go:80-106`) with the 1.2.a operations the existing engines already support: balance, history, quote (priced at server `now()` only, EM-19), purchases and grants. Add the rest as their tasks land.
  - [ ] 4.1.c Implement the HTTP side of `ledger-client` for the 4.1.b operations. Staging stays on `LEDGER_MODE=fake` until every 1.2.a operation has a live route (4.9.e).
  - [ ] 4.1.d **Check:** the contract-spec cases for the 4.1.b operations pass against live, the rest are `it.todo` until their task lands, and the ledger rejects an unsigned call.
- [ ] **4.2 Chart of accounts and posting rules: decide first, then code** · needs: 4.1
  - [ ] 4.2.a **Keep the credit-positive convention** from migration `20260919000002`. Fix `FundReserve` (`chart.go:260-264`) and read asset balances as −SUM. Every sign-dependent reader must agree: `EarnPoints`, `BurnPoints`, `ExpirePoints`, `IssueMarketingPoints`, `SumPointsOutstanding` (`pricing.sql:31-44`), the balance and history endpoints, and the overdraft guard (EM-15).
  - [ ] 4.2.b Add `ledger.account.purpose` (`main`, `available`, `pending`, `escrow`, `payable`) and replace `account_one_per_owner_currency` with a unique index on (owner_type, owner_id, currency, purpose). Platform accounts are per region; a user's points accounts are in their region only (EM-12). `SumPointsOutstanding` sums available + pending + escrow.
  - [ ] 4.2.c Posting rules, as Dr / Cr, where C is the region currency. A movement touching two currencies is two transfers in one transaction.

    | Event | Posting |
    | --- | --- |
    | Purchase | Dr reserve_C X / Cr partner_funding_C X. **No spread-revenue posting**: spread is reported only (9.5). |
    | `fundMarketing` (staff, two-person) | Dr marketing_cash_C X / Cr platform_equity_C X |
    | Marketing backing (inside each `grantAction`) | Dr reserve_C ⌈M×B/1e6⌉ / Cr marketing_cash_C |
    | Grant | Dr points_issued (partner) or marketing_expense (marketing) / Cr user.pending |
    | Release | Dr user.pending / Cr user.available |
    | Burn | Dr user.available P / Cr points_redeemed P, **and** Dr redemption_clearing_C S / Cr voucher_liability_C S |
    | Capture | Dr voucher_liability_C / Cr merchant_payable_C |
    | Partial refund | reverse that capture's share |
    | Payout | Dr merchant_payable_C / Cr reserve_C |
    | Voucher expiry or forfeited remainder | Dr voucher_liability_C / Cr redemption_clearing_C |
    | Points expiry (when enabled) | Dr user.available / Cr breakage_revenue |
    | Suspend | Dr user.available + pending / Cr user.escrow; release reverses it |
    | Reversal | the exact inverse, referencing the original transfer |
  - [ ] 4.2.d **Check:** a trial balance by account kind passes. After a 100-pt grant, points outstanding = +100, and coverage is not reported as "no points outstanding".
- [ ] **4.3 Ledger guards** · needs: 4.2
  - [ ] 4.3.a Overdraft guard: a per-account `pg_advisory_xact_lock`, and no debit below zero, for user available, pending and escrow, marketing cash and merchant payable. Test: two concurrent burns of 400 and 400 on a balance of 500 → exactly one succeeds (EM-04).
  - [ ] 4.3.b A trigger enforces `entry.currency = account.currency`, and balance queries filter by currency (EM-09).
  - [ ] 4.3.c Idempotency: store a request hash, so the same key with a different payload returns `idempotency_conflict` and a replay returns the original result (EM-14). Transfer and grant IDs include the user ID (EM-17, EW-13).
  - [ ] 4.3.d Seal transfers:
    - a trigger forces `created_at = now()`, and entries cannot be added to a transfer from an earlier transaction (EM-18);
    - `validate` uses checked int64 addition, and the checker sums as numeric (EM-23).
  - [ ] 4.3.e Add `/v1/burns` (`burnForVoucher`, `getBurn`, `reinstateBurn`) on these guards, where `reinstateBurn` is K13.
  - [ ] 4.3.f **Check:** each of EM-04/09/14/17/18/23 has a test that failed before the fix and passes after.
- [ ] **4.4 The Reward Engine pays what the partner set, once** · needs: 4.3
  - [ ] 4.4.a The amount comes from the **frozen terms version**, never from the editable `reward_config`, so viewers are paid the terms they entered under (EM-05, EM-16, EW-05).
    - A migration creates the view `campaign.campaign_owner(id, business_id, region, state)`, with SELECT granted to `yourtal_ledger`.
    - A grant is refused unless all of these hold: the allocation's funder type is partner; the funder is the campaign's owner; the allocation's country is the campaign's region; and the campaign is live.
    - **Delete the constant 2,400 at `taxonomy.go:89`.**
  - [ ] 4.4.b Bonus = `floor(accuracy_bonus_points × correct ÷ asked)`, when the terms' scoring rule is base_plus_accuracy_bonus; the base requires every asked question answered. The bonus counts toward `max_points_for_campaign`.
  - [ ] 4.4.c Evidence: apps/api signs a completion attestation with HMAC over session, user, campaign, terms version, completion time, **asked and correct** (EW-12).
  - [ ] 4.4.d **One reward per user per campaign:** `UNIQUE (user_id, campaign_id)` for watch-completed grants, returning `already_granted`.
  - [ ] 4.4.e Allocation holds. At reward-session start, `hold` base + maximum bonus with a TTL of 2 × duration + 1 h. The grant consumes the hold; abandonment or expiry releases it through a job. This way a viewer is never refused at the end for `allocation_exhausted`. The decrement-only `SECURITY DEFINER` function has four verbs: hold, consume, release and return. Revoke the ledger role's UPDATE on allocations (EM-08).
  - [ ] 4.4.f Velocity caps and the daily and monthly caps (F12) are counted inside the transaction, under a per-user advisory lock, using the database's `now()` (EM-06, EW-11).
  - [ ] 4.4.g Holdback: grants post to **pending** with `unlock_at` by trust tier (F12). A job releases them to available (skipping escrowed users) and emits the `ledger.points_unlocked` pg-boss event (EM-13).
  - [ ] 4.4.h K6: every point not paid for by a business is backed by cash.
    - `grantAction` (streak, receipt, goodwill) draws only from a marketing allocation funded by marketing cash → reserve in the same transaction.
    - Marketing cash is increased only by `fundMarketing` (two-person, staff) and by the seed.
    - A partner allocation can only come from a `point_purchase`.
    - Rewrite the test that currently asserts the opposite (EM-02).
  - [ ] 4.4.i Purchases:
    - check `amount_minor × 1_000_000 ≥ points × issue_micros` in integers;
    - the server computes the charge with `quotePurchase` (packs per F12);
    - add `CHECK B × 1.25 ≤ P_issue`;
    - pin the multiplier at 1.00 (EM-11).
  - [ ] 4.4.j **Check:**
    - five concurrent grants at a cap of 19/20 → exactly one succeeds;
    - a campaign pointed at another business's allocation is refused;
    - a second session on the same campaign earns nothing;
    - a marketing grant larger than marketing cash is refused.
- [ ] **4.5 Voucher core API: generation, reservation, QR and devices (was YT-0594, YT-0150/0151)** · needs: 4.1
  - [ ] 4.5.a Every 1.2.b operation behind service auth, including these:
    - batches whose terms are derived from the listing, with the supplier required to equal `listing.merchant` (D12);
    - `reserve(listing, sagaId)`: Minted → Allocated with `saga_id` and `reserved_until` = now + 15 min. This **is** the stock reservation: stock is the count of unallocated vouchers in approved batches.
    - `release(sagaId)`: Allocated → Minted, a new transition, allowed only when `getBurn` finds no burn.
  - [ ] 4.5.b QR: a `voucher_qr` keyring purpose. `qrToken` returns 12 signed tokens for consecutive 5-minute windows, which the wallet caches for offline display. Authorize accepts either a QR token or a code.
  - [ ] 4.5.c Device mode (requested by C): a platform credential asserts `merchant_id` and `device_id`; a migration adds `voucher.authorization.device_id`; a device principal is refused on void and refund with 403.
  - [ ] 4.5.d Merchant HMAC credentials: issue, rotate and revoke endpoints (requested by C for 8.3). The kill switch gets an HTTP route next to the CLI.
  - [ ] 4.5.e Region: vouchers carry their region and currency, and authorize refuses a merchant from the other region.
  - [ ] 4.5.f **Check:** `voucher-client.contract.spec.ts` passes against live, and an AUD voucher reserves, activates, shows a QR token, authorizes and captures.
- [ ] **4.6 Voucher hardening** · needs: 4.5
  - [ ] 4.6.a Enforce the lifecycle inside `issue.Move` and with a database transition trigger. Capture and void require `held` (D3). A swept stale hold returns the voucher to active (D15).
  - [ ] 4.6.b Kill switch: check it after the code lookup (batch, merchant and global scopes) and again inside Capture (D4). The throttle counts only probes (D13). `ErrStaleVersion` returns 409 (D14).
  - [ ] 4.6.c Authorize takes `order_total_minor`. Minimum spend is checked against it and re-checked at capture (D5). An authorize replay compares code hash, amount and currency (D7).
  - [ ] 4.6.d Idempotency:
    - record completion on `context.WithoutCancel`, reclaim stale rows, and make `refund_ref` unique per capture (D8);
    - put `Idempotency-Key` and the query string in the HMAC canonical string, and remember nonces (D9).
  - [ ] 4.6.e Tamper evidence: assert `version == max(seq)`, replay the remaining value, and anchor each voucher's head in the ledger's daily proof (D6, F11).
  - [ ] 4.6.f The capture transaction writes a `capture_outbox` row, which a worker job posts to the ledger with idempotency key = capture ID (feeds 10.1).
  - [ ] 4.6.g **Check:**
    - goroutine concurrency tests on one voucher (authorize×authorize, capture×void, refund×authorize) pass;
    - every scenario from D1 to D16 has a test;
    - D17 was refuted and needs no work.
- [ ] **4.7 Burn saga: points become a voucher exactly once** · needs: 4.3, 4.5
  - [ ] 4.7.a `apps/api/src/modules/checkout`: `POST /api/checkout/quote` locks a price for 15 minutes, and `POST /api/checkout` (with `Idempotency-Key`) runs these steps in order:
    1. pre-check available ≥ the locked price, with no side effects;
    2. voucher `reserve`;
    3. ledger burn keyed `burn_<sagaId>` from available, posting voucher liability at the quote's S;
    4. `activate`;
    5. mark the saga done in `checkout.saga`.
    
    Failure before step 3 → `release`. Failure after step 3 → retry `activate`; only an unusable voucher gets void + reverse. A recovery job handles `Allocated` past `reserved_until`: activate if the burn exists, release if not.
  - [ ] 4.7.b Refuse with `region_mismatch` unless listing region = user region = quote currency's region. Refuse with `audience_blocked` for a disallowed age band. Refuse `online` listings below trust tier 2 (trust-tiered fungibility, docs/16). The ledger re-checks region inside the burn.
  - [ ] 4.7.c K13, a voucher the merchant would not honour: `POST /api/wallet/vouchers/:id/dispute` (called by B's 6.5).
    - An **uncaptured** voucher is voided and `reinstateBurn` returns the exact points to available at once.
    - A **captured** one goes to the staff queue (9.4), and a recovery line is posted against that merchant (10.1).
  - [ ] 4.7.d **Check:**
    - a double submit burns once;
    - killing the voucher service mid-saga leaves the balance whole after recovery;
    - an ID user's burn of an AU listing is refused even when the ledger is called directly.
- [ ] **4.8 Wallet API** · needs: 4.7
  - [ ] 4.8.a `apps/api/src/modules/wallet`: `GET /api/wallet` (available, pending with unlock dates, expiring), `/api/wallet/history` (plain-language entries built from the ledger's references), `/api/wallet/vouchers`, `/api/wallet/vouchers/:id` and `/api/wallet/vouchers/:id/qr`.
  - [ ] 4.8.b **Check:** the wallet shows a pending grant with its unlock date and a bought voucher with a QR token.
- [ ] **4.9 Pricing, rates and solvency are enforced, not just calculated** · needs: 4.4
  - [ ] 4.9.a The ledger owns `ledger.listing_price(listing_id, points, s_minor, currency, rate_id, computed_at)`. It is upserted by `priceListing` (called by C's 7.4 on create or when S changes) and recomputed by a ledger job when a rate takes effect. apps/api reads only listing ID and points through a `SECURITY DEFINER` view.
  - [ ] 4.9.b Rate governance inside the ledger:
    - `proposeRate` / `approveRate`, with `approved_by ≠ set_by` (CHECK);
    - `effective_from ≥ created_at`;
    - a cut to B takes effect no sooner than now + 15 min, so locked quotes are honoured.
    
    Seed ID B 6_000_000 / P_issue 9_000_000 micros and AU B 3_000_000 / P_issue 4_500_000 micros (F1). Remove the test rates with a one-off superuser script.
  - [ ] 4.9.c Solvency monitor: every 15 minutes, per region, coverage = reserve ÷ ((available + pending + escrow points) × B + voucher liability + unpaid merchant payable).
    - Below **1.2**: alert.
    - Below **1.1**: stop marketing-funded grants.
    - Below **1.0**: block all unfunded issuance, checked inside `Grant` (EM-10).
  - [ ] 4.9.d B never reaches a browser.
    - No API response carries it.
    - The bundle test fails if any client chunk contains `micros_per_point`, `issuePriceMicros` or `backingMicros`.
    - `MOCK_BACKING_RATE` is allowed only in the three files that B (6.6.b) and C (7.8.c) remove. 13.5.c deletes the rest.
  - [ ] 4.9.e Switch staging to `LEDGER_MODE=live`; all of `ledger-client.contract.spec.ts` passes against live.
  - [ ] 4.9.f **Check:**
    - after an AU purchase of 1,000 pts that is fully granted, coverage = 1.50 and a streak grant succeeds;
    - burn → capture → before payout, coverage is unchanged to one minor unit;
    - after `pnpm verify`, the AU rate is still 3_000_000.

**Done when:** every verified defect in the three engine reports is fixed with a regression test; points, rates and vouchers never cross regions; the ledger and voucher services accept only signed internal calls from apps/api.

## Phase 5 — Watch & earn · Area B · ~5d

Earning is the product. Today completion is hard-coded to refuse (`watch.controller.ts:186`), the browser receives the answer keys and scores itself, and the progress check can be farmed. Build it server-first and the UI second, against the 1.2 fake until Phase 4 lands.

- [ ] **5.1 A watch session that cannot be farmed** · needs: 1.5, 7.2.c (fake ok)
  - [ ] 5.1.a Cumulative budget: total accepted seconds ≤ (now − `startedAt`) + one tolerance. Take a per-session row lock (or compare-and-set on `last_progress_at`), anchor each span to the last accepted end, and rate-limit `progress` (EW-01). Add burst and parallel regression tests.
  - [ ] 5.1.b Coverage is keyed by (user, campaign, terms version), not by session.
    - Starting a reward session on Y **parks** X (a new state, resumable while the campaign is live and the terms version is unchanged), instead of destroying X's coverage.
    - Only one session is active at a time.
    - Starting a reward session on a campaign already granted to this user returns `already_earned`; a non-earning replay is allowed.
    - Session start takes the allocation hold (4.4.e, fake ok). If the hold fails, the session starts non-earning, with the reason shown.
  - [ ] 5.1.c Completion:
    - it reports whether its conditional update matched, and only the winner grants (EW-10);
    - its target comes from the session's terms version (EW-20);
    - coverage intervals are merged before counting;
    - progress is refused for paused or ended campaigns (EW-19).
    
    Until 7.2 lands, seed campaigns use `durationSeconds = 30` to match the fixture, through `seed/watch.ts`. Delete `time-remap.ts` (EW-07).
  - [ ] 5.1.d Signed segments (EW-18). Session start returns a per-session manifest URL from `signedSegmentUrl()` in `@yourtal/media` (requested by B; C exports it in 7.2.c). Until then, B calls a local stub with the same signature that returns an unsigned URL. nginx checks the signature (2.1.c). A records the served segments and exposes `deliveryCoverage(sessionId)` (10.4.c), which B's completion calls to flag gaps.
  - [ ] 5.1.e **Check:**
    - 600 progress reports in 3 s cover at most ~3 s;
    - opening another campaign parks the first, and resuming it keeps its coverage;
    - a second reward session on an earned campaign is refused.
- [ ] **5.2 Questions during the video, served and scored on the server (F10)** · needs: 5.1
  - [ ] 5.2.a One count everywhere (EW-21): `questionsAskedFor` (1.1.f) is used by `checkpoint.controller` (replacing `campaign.questionCount`), Studio validation (7.3) and the seed.
  - [ ] 5.2.b Schedule: checkpoints at server-chosen times within 20–90% of the duration. Each question has its required `answerableAfterSeconds` (1.1.f), and only questions answerable by that time are picked. The next checkpoint's time is revealed only once coverage reaches it. A token is issued once per (session, index) (EW-08), and only for live campaigns (EW-19).
  - [ ] 5.2.c `GET /api/watch/sessions/:id/checkpoints/:i` returns a `PresentedQuestion` with **no answer key**, from `selectQuestionsForSession`: a per-user subset and shuffled options. Playback pauses while the question is open; the server timer is 30 s.
  - [ ] 5.2.d `POST …/checkpoints/:i/answer` (with the token) scores against `question_answer_key` and writes `question_response` with server-measured latency. A timeout is recorded as answered and wrong. The answered-once record lives in a table that is never pruned (EW-09).
  - [ ] 5.2.e Remove the answer keys and client scoring from apps/web (`checkpoint-scoring.ts`, `checkpoint-data.ts`), and require `import type` for question contracts in apps/web (EW-04). The bundle test searches for `correctOptionId` and the seeded answer-key option IDs.
  - [ ] 5.2.f Derive `questionsAnswered`, `asked` and `correct` from `question_response`, and remove the hard-coded `false` at `watch.controller.ts:186`.
  - [ ] 5.2.g **Check:** in an HTTP round trip, a question arrives with no key, a wrong answer and a timeout are both scored wrong by the server, and a 60 s campaign issues exactly one checkpoint.
- [ ] **5.3 Completion grants the reward (EW-06)** · needs: 5.2, 4.4 (fake ok)
  - [ ] 5.3.a On completion, call `ledger-client.grantReward` with `ExternalRef = sessionId` and the signed attestation including asked and correct (4.4.c). The response is the pending points and their unlock date, and the UI shows exactly that figure.
  - [ ] 5.3.b **Check:** in an HTTP round trip, start → progress → answer all → complete produces a ledger pending entry for the terms' points. A second complete returns the same result with no second grant.
- [ ] **5.4 The viewer's own API** · needs: 1.5
  - [ ] 5.4.a `apps/api/src/modules/me`: `api/me/consents` stored in a new append-only `identity.consent_record` table shaped like `consentRecordSchema` (read through `latestPerPurpose`), interests, follows (`/api/me/follows/:businessId`, a ranking signal only), saves (a private Watch later list) and `api/me/sessions` (continue watching = parked and active sessions with coverage).
  - [ ] 5.4.b Delete account runs `dsar-orchestrator` with the Postgres handlers, plus (requested by B from A) handlers for profile, credentials and sessions. Download my data returns the DSAR export.
  - [ ] 5.4.c Linked apps: a one-time link code that the user copies into snap-app (8.4).
  - [ ] 5.4.d **Check:** withdrawing ad-targeting consent is recorded and returned by `GET /api/me/consents`, and account deletion removes the profile and ends every session.
- [ ] **5.5 Streak and notifications on the server** · needs: 5.4, 4.4 (fake ok)
  - [ ] 5.5.a The streak follows F12: a day counts when it has ≥ 1 completed reward session on the region clock (F16). The bonus goes through `grantAction(streak)` on days 3 and 7, paused while coverage < 1.1, and teens get none. Delete `streak-schedule.ts` and the localStorage streak store.
  - [ ] 5.5.b `GET /api/me/notifications` is fed by pg-boss events: `ledger.points_unlocked`, `ledger.points_expiring` (only if expiry is enabled), and new campaigns from followed channels. Notification preferences are stored. A simulated web-push driver.
  - [ ] 5.5.c **Check:** a third streak day grants the F12 bonus once, and unlocked points raise a notification.

**Done when:** a signed-in user can watch a campaign, answer the questions that pause it, and see pending points appear in the ledger for exactly the terms the business set, once per campaign. The audit's farming probes all fail.

## Phase 6 — Viewer app · Area B · ~7d

Rebuild and wire every consumer screen on the Phase 3 primitives. Every screen task includes:

- live data through `apiFetch`;
- a rebuild on the primitives;
- a **copy pass**: one language per screen, strings in the catalogues, no ticket IDs, doc references or "prototype" / "demo" notes, and the Phase 3 copy rules;
- loading, empty, error and API-down states;
- screenshots at 390 px and 1280 px, light and dark, with axe clean.

- [ ] **6.1 One i18n system, English by default** · needs: 3.4
  - [ ] 6.1.a Fold the four mechanisms (the next-intl provider, 10 `createTranslator` wrappers, the TS copy modules and the inline `locale === "id-ID"` ternaries) into next-intl catalogues, one namespace per feature, in B's features. en-AU is the default and id-ID is complete.
  - [ ] 6.1.b Display language is independent of region, stored in `profile.display_locale` and the `yt_locale` cookie. Add a language switch on Me and in the public header. `i18n/request.ts` reads only `yt_locale` and `yt_region` (1.7.b).
  - [ ] 6.1.c Make B's `id-ID` / `IDR` default parameters required (the list is in `public-i18n.md` A.2 §2). B's features call `formatPointsIn(locale, amount)` (1.7.d).
  - [ ] 6.1.d Move the hard-coded Indonesian and English-only strings in B's features into the catalogues (lists in `public-i18n.md` A.2 §4–5). The 3.6.c lint rule becomes an error. C does the same for its features in 7.8, 8.2 and 9.1.
  - [ ] 6.1.e **Check:** switching language on Me changes every viewer screen, and a JSX literal in B's features fails lint.
- [ ] **6.2 Sign up, log in, onboarding** · needs: 6.1, 1.6
  - [ ] 6.2.a `(auth)` routes call the 1.4 endpoints and keep `returnTo`:
    - `/register`: email, password, display name, date of birth, region (AU preselected), language, and a guardian-email field that appears when the date of birth gives 13–17 and the flag is on;
    - `/login`, `/forgot`, `/reset` and `/verify`.
  - [ ] 6.2.b Onboarding after register: per-purpose consent, then interests (only if targeting consent was given, which the step says), then follow 3 channels, then done, which goes to `returnTo`. **Delete** the phone-OTP mock (`otp-mock-service.ts`, `DEMO_OTP_CODE`) and the hard-coded reward amounts (`region-option.ts:31,37`, `done/page.tsx:22`).
  - [ ] 6.2.c **Check:** a new AU account created through the UI lands on Home in English, and an ID account lands in Indonesian.
- [ ] **6.3 Home: the For You feed** · needs: 3.5, 7.7 (fake ok), 5.3
  - [ ] 6.3.a A vertical feed of campaign teasers from C's feed API. Each item shows the channel avatar, the title and honest terms before any action: "18 min · 3 questions · up to 112 pts · ~120 MB · finish to earn" (AU; F12).
  - [ ] 6.3.b **Quick campaigns (under 60 s, so they have no questions; F15) earn inside the feed.** Tapping Earn starts a reward session in place, and the earn moment lands in the item before the user swipes on. Longer campaigns show a teaser and **Watch & earn**. `/quick` redirects to Home.
  - [ ] 6.3.c Rows (desktop) or tabs (mobile): Continue watching, Saved, From channels you follow, Ending soon. The feed ends with "You're all caught up · N pts earned today". The streak strip shows each grant's own unlock date and never names a tier.
  - [ ] 6.3.d Each item offers Share (Web Share API to the public campaign page, with no reward), Save, Not interested, and "Why am I seeing this?", which explains the 7.7 ranking.
  - [ ] 6.3.e **Check:** on staging (after 7.2.e media), a new user scrolls the feed, earns a Quick campaign in place, and the wallet shows it pending.
- [ ] **6.4 Watch: campaign page and player** · needs: 6.3
  - [ ] 6.4.a The campaign page works like a YouTube watch page: player, channel row with Follow, the terms card, chapters, and more from this channel. The terms card states the question count, "stopping early earns nothing" and "new accounts' points unlock after up to 3 days", and shows absolute points from the terms. **Delete `campaign-reward-split.ts`** (its `BASE_REWARD_RATIO = 0.6` is not what gets paid).
  - [ ] 6.4.b Wire the player to 5.1–5.3:
    - the progress bar shows server coverage (EW-15);
    - playback rate is locked to 1 and playback pauses when hidden, in reward sessions (EW-14);
    - question overlays with the pause and the 30 s timer;
    - captions;
    - a video error state and a resume prompt.
  - [ ] 6.4.c The completion screen: the earn moment, an **Up next** card that needs a tap (never autoplay), and the funder's own vouchers ("Spend at <brand>", docs/23 §1.0b).
  - [ ] 6.4.d In-app channel pages at `/c/[handle]`: cover, logo, Follow, the channel's campaigns and its vouchers.
  - [ ] 6.4.e **Check:** a full campaign watched on staging pauses for its questions, then shows the earn moment and Up next.
- [ ] **6.5 Wallet and voucher** · needs: 4.8 (fake ok)
  - [ ] 6.5.a A balance card shows available, pending (with unlock dates) and expiring (only if expiry is enabled), above a plain-language history.
  - [ ] 6.5.b Each voucher is a pass:
    - the code in a mono face;
    - the QR from 4.5.b, with 12 five-minute tokens cached in IndexedDB so it works offline for an hour, then the static code;
    - its status;
    - **"This voucher didn't work"** (4.7.c).
  - [ ] 6.5.c **Check:** the QR changes every window and shows with the network off, and a dispute on an unused voucher returns its points exactly once.
- [ ] **6.6 Store and checkout** · needs: 4.7 (fake ok), 7.4
  - [ ] 6.6.a The store is a shoppable grid with images, filters (category, channel, price) and the balance chip. It shows only the viewer's region and audience (7.4.d).
  - [ ] 6.6.b The offer page shows terms, locations, channel and expiry. **Get it** locks the price with a countdown (4.7) and checks out, with errors in plain language (the 1.2.c enum). (requested by A) Delete `burn-data.ts`'s rate and `wallet-history.ts`'s mock rate (4.9.d).
  - [ ] 6.6.c **Check:** the bought voucher is in the wallet immediately, the balance drops by the locked price, and an ID account never sees an AU listing.
- [ ] **6.7 Me** · needs: 5.4
  - [ ] 6.7.a Profile, language, interests, follows, per-purpose consent (withdrawal takes effect), password change, log out, delete account, download my data, notification settings, linked apps (5.4.c) and an autoplay setting (Always / Wi-Fi only / Never; Wi-Fi only by default in ID).
  - [ ] 6.7.b **Check:** logging out ends the session on the server, and the autoplay setting holds on the feed.
- [ ] **6.8 Notifications and search** · needs: 5.5, 7.7
  - [ ] 6.8.a A bell in the top bar showing 5.5.b notifications.
  - [ ] 6.8.b Search results (from 7.7.c) for campaigns, channels and vouchers.
  - [ ] 6.8.c **Check:** a search for a demo brand finds its channel and vouchers.

**Done when:** the whole viewer journey (register → feed → earn in place → watch with questions → store → voucher in wallet → dispute) works on staging in both regions, on the new design, with no mock data and no hard-coded strings.

## Phase 7 — Business studio · Area C · ~9d

The business console becomes **YourTal Studio**, in the spirit of YouTube Studio. Work in this order, which overrides task order: 7.1 → 7.4 → 7.5 → 7.3 → 7.2 → 7.7 → 7.8 → 7.6. Every Studio route sits under `api/:tenantId/studio/...`. Evidence: `docs/audit/2026-09-25/business-merchant.md`.

- [ ] **7.1 Business accounts** · needs: 1.1, 1.3.a, 1.3.b, 1.6 (fake ok)
  - [ ] 7.1.a Migration: a tax ID kind and value (ABN for AU, NIB or NPWP for ID) and an address (state and postcode for AU, city for ID). Region, currency and handle came in 1.1. `district` is no longer required.
  - [ ] 7.1.b `modules/business/my-businesses.controller.ts` provides `GET /api/me/businesses`, plus the create-business flow. KYB documents upload through a presigned MinIO URL, so `storageRef` points to a real upload. Review happens in 9.3.
  - [ ] 7.1.c Team invites by **email**: an invitation token, sent through an `InvitationMailer` port in the business module that is bound to 1.6's simulated email driver once 1.6 is merged (never add a driver to `packages/drivers`), and an accept endpoint that sets `joined_at`. Add transfer ownership.
  - [ ] 7.1.d **Check:** an HTTP round trip creates an AU business with an ABN, and an invite is accepted through the inbox.
- [ ] **7.2 Media pipeline, self-hosted (replaces Cloudflare Stream)** · needs: 1.3
  - [ ] 7.2.a Upload with a presigned multipart PUT to MinIO (`raw/…`), with size and type limits.
  - [ ] 7.2.b An `apps/worker/src/jobs/transcode.ts` job runs ffmpeg to produce:
    - HLS at 360p, 540p and 720p with 6 s segments, recording bytes per rendition (`estimatedBytes` uses 540p);
    - a poster;
    - the **teaser**: a progressive MP4 (H.264, 540×960, ≤ 800 kbps, faststart, ≤ 1.5 MB). A 9:16 source is cut from `teaserStartSeconds` for 15 s. A 16:9 source is not cropped: it is scaled to width and centred on a blurred, zoomed copy of the same frame;
    - an optional WebVTT caption track.
    
    The worker calls C's internal `POST /internal/studio/media/:assetId/ready`, and the studio module writes the campaign's media columns. The worker never touches campaign tables. A failure is visible in Studio.
  - [ ] 7.2.c Media URLs come from config, **never** from `127.0.0.1` literals (`campaign.mock.ts:48-49`). (requested by C) A's nginx routes (2.1.c). Export `signed-segment-url` from `packages/media` for B's 5.1.d.
  - [ ] 7.2.d The demo media kit (F7): `pnpm demo:media` fetches the Pexels and Blender clips listed in `demo-media.json`. Per campaign that manifest holds the brand, the clip, and 3–5 facts to burn in with ffmpeg `drawtext` at stated timestamps. It muxes a CC0 music bed into silent clips, and generates brand logos as SVG monograms. Licences are recorded per clip. Questions are generated from the facts, and each fact's timestamp becomes the question's `answerableAfterSeconds`.
  - [ ] 7.2.e `pnpm demo:media` has produced 8 campaigns and 6 vouchers per region on staging (feeds B's 6.3.e and 11.1).
  - [ ] 7.2.f **Check:** a 3-minute mp4 uploaded on staging becomes HLS, a poster, a teaser under 1.5 MB and captions within about 2 minutes.
- [ ] **7.3 Campaign authoring API** · needs: 7.5, 7.1
  - [ ] 7.3.a Draft CRUD covering:
    - title, description, `contentCategory` (a `prohibited` category is refused at save, per 1.1.d) and audience (a restricted category forces adult);
    - targeting: region is fixed by the business; declared interests apply only with the viewer's consent;
    - schedule (`startsAt`, `endsAt`), the Open Viewing opt-in (off by default; only all_ages campaigns can opt in), `teaserStartSeconds` and the poster frame, or an uploaded vertical teaser;
    - chapters and captions.
  - [ ] 7.3.b Question bank CRUD:
    - at least 3× as many questions as `questionsAskedFor` asks (F10), each with a required `answerableAfterSeconds`;
    - the PII guard (`question-pii-guard.ts`) moves to the server;
    - no prediction or guessing questions, with a type enum that has no prediction type and moderation flagging "will / predict / guess" (red line 1);
    - answer keys are write-only.
  - [ ] 7.3.c Reward and budget:
    - points per completion **plus the maximum accuracy bonus** within the F12 ceiling (F14);
    - an accuracy bonus ≤ 40% of the base;
    - maximum points for the campaign;
    - the allocation must be one of the business's own (`listAllocations`) with funder type partner.
    
    Publishing snapshots a terms version that includes the bonus.
  - [ ] 7.3.d Lifecycle `draft → in_review → live → paused → ended`, enforced by `canTransition` and by a database trigger (EW-17). Submitting is refused while the business is not KYB-verified (red line 7) and sends the campaign to moderation (9.2).
  - [ ] 7.3.e **Check:** an HTTP round trip creates a funded campaign at the F12 ceiling, with a question bank, and submits it to `in_review`; one point per minute above the ceiling is refused.
- [ ] **7.4 Inventory (vouchers)** · needs: 7.1, 4.9 (fake ok)
  - [ ] 7.4.a Locations CRUD. Today only the seed creates `store.merchant_location`, so a new business cannot list anything.
  - [ ] 7.4.b Listing CRUD. The supplier declares face value, S (≤ face value), locations, channel, partial-redemption policy, expiry, minimum spend, `contentCategory` and audience.
    - **Remove `priceInPoints` from `create-listing.schema.ts:16,32`** (EM-01). The price is `ledger-client.priceListing`, read-only for the business, and the set-settlement-value use case calls it too.
    - A decrease to S goes through the existing two-person propose/approve flow with no threshold; keep `settlement-decrease.controller` and its tests.
  - [ ] 7.4.c Stock: `store.listings.stock_remaining` becomes a read-only projection of unallocated vouchers (4.5.a). A voucher batch request goes to staff approval (9.2) and is then minted through 4.5.
  - [ ] 7.4.d Consumer catalogue reads (`GET /api/store/listings[/:id]`) filter by the caller's region (anonymous visitors: the path region) and audience. They return `imageUrl`, category and channel, and filter by category, channel and price.
  - [ ] 7.4.e **Check:** a request carrying `priceInPoints` is rejected; the listing price equals the ledger quote; an ID user never sees an AU listing through list or get.
- [ ] **7.5 Billing: buy points** · needs: 7.1, 4.4 (fake ok)
  - [ ] 7.5.a `quotePurchase` shows pack prices (F12; P_issue appears only here, never on consumer surfaces). `POST /api/:tenantId/studio/billing/purchases` goes through the simulated payments driver, with the currency always stated (no IDR default), to a ledger purchase. That funds the region reserve and creates the business's allocation, idempotently.
  - [ ] 7.5.b Balance, per-campaign spend (`campaignSpend`) and remainder (remaining minus active holds). Unused points stay with the business; there are no cash refunds. Statements come from 10.1, and `POST …/statements/:id/dispute` holds the payout.
  - [ ] 7.5.c **Check:** a simulated purchase appears as a ledger purchase with its allocation, and a replay does not charge twice.
- [ ] **7.6 Reports** · needs: 7.3, 5.3, 8.2 (fake ok: the voucher fake provides `merchantCaptureStats`)
  - [ ] 7.6.a Per campaign, **aggregates only**, each suppressed below the F12 cohort floor:
    - rewarded views, completions, completion rate, average watch time, question accuracy, points spent;
    - "your points bought N views and M of your own vouchers were redeemed" (docs/23 §1.0b, from `merchantCaptureStats`).
    
    **Open views are a separate metric from a separate query, never summed** with rewarded views. No user IDs appear in any report or export (red line 10).
  - [ ] 7.6.b **Check:** the numbers match the database for one seeded campaign, and a group below the floor shows as suppressed.
- [ ] **7.7 Feed and discovery engine (the rules engine)** · needs: 7.3, 5.4
  - [ ] 7.7.a `apps/api/src/modules/feed`: `GET /api/feed?surface=home|watch`.
    - **Filter:** live; within schedule; funded (allocation remaining after holds); pacing allows it; region = viewer region; audience allowed for the viewer's age band (1.1.c); not already earned by this viewer.
    - **Rank:** reward per minute, followed-channel boost, freshness, audience match (teen items boosted for teens; parents items for declared parents), and declared-interest match **only with ad-targeting consent** and a segment of at least the F12 targeting minimum (1,000; 1 on staging).
    - **Diversity:** at most 2 in a row from one business.
    
    Every item returns a "why" explanation. "Not interested" demotes on the next fetch. Anonymous callers (Open Viewing) get only campaigns with `openViewing` that are rated all_ages, in the path region, unpersonalised.
  - [ ] 7.7.b Pacing: per-campaign `pacing_state`, used by `canServe` (advisory, since the hard stop is the allocation hold). "Ending soon" = `endsAt` within 72 h, or allocation remaining below 10% (EW-16).
  - [ ] 7.7.c `GET /api/search?q=` over campaigns, channels and listings, filtered by region and audience.
  - [ ] 7.7.d **Check:**
    - a campaign with no allocation never appears;
    - an ID viewer never sees an AU campaign;
    - a followed channel ranks higher;
    - without consent, interests do not change the order.
- [ ] **7.8 Studio UI** · needs: 3.5
  - [ ] 7.8.a The `(business)` route group at `/studio` with StudioShell (studio theme). In the same merge, add `/business/:path*` → `/studio/:path*` to `route-redirects.ts`.
  - [ ] 7.8.b Screens:
    - onboarding: create a business (region fixed, tax ID by region, address), KYB upload, and a verification banner that blocks submit;
    - the overview, whose empty state is a setup checklist: channel → buy points → upload → questions → submit;
    - campaigns list and builder: upload with real progress, questions, reward within the ceiling, audience and category, schedule, Open Viewing, teaser picker, captions, preview as a viewer;
    - inventory, with pending S-decrease approvals;
    - billing and reports;
    - redemptions: today's and recent captures per location and device;
    - team, with working dialogs;
    - channel settings: logo, cover and handle.
  - [ ] 7.8.c Copy pass:
    - delete the ticket IDs and doc references (`console-zone-placeholder.tsx:23`, `reports-provenance-legend.tsx`, `question-editor.tsx:73`);
    - (requested by A) `campaign-reward-risk.ts` uses a server-computed ratio, with B removed (4.9.d);
    - all copy in `messages/*/studio.json` (en-AU and id-ID);
    - the Phase 3 lint rules become errors for `features/{console,studio}`;
    - no statistics or promises about redemption, breakage or ROI (red line 5).
  - [ ] 7.8.d **Check:** on staging a new business goes from sign-up to a submitted, funded campaign using only the Studio UI.

**Done when:** a business owner can register, set up a channel, buy points (simulated), upload a video, write questions, fund and submit a campaign, list a voucher, see redemptions and read real reports, all in Studio on staging.

## Phase 8 — Voucher engine for clients · Area C · ~5d

F11: vouchers must really work for YourTal, brands and users. That means generation (4.5), redemption at the counter and online, and a secure SDK brands can integrate. Tamper evidence is the voucher hash chain anchored in the daily proof, whose root is published (10.3). No blockchain for now.

- [ ] **8.1 Counter devices** · needs: 1.5, 4.5
  - [ ] 8.1.a Studio → Team → Devices provisions a counter device:
    - a server-side device record;
    - a one-time pairing code;
    - a device credential, stored hashed;
    - a PIN per device, hashed with argon2id (not the unsalted SHA-256 in `pin-hash.ts`).
    
    Devices are revoked from Studio only; today `/merchant/devices` revokes with no auth.
  - [ ] 8.1.b The `store_device` principal comes from the device credential (1.5.c), so the Cerbos `redemption.yaml` device rules take effect.
  - [ ] 8.1.c **Check:** a paired device gets a principal, and a revoked one gets 401.
- [ ] **8.2 Redeeming at the counter** · needs: 8.1, 4.6
  - [ ] 8.2.a CounterShell flow: pair → PIN unlock → scan the QR (camera) or type the code → server-side lookup → authorize (amount, order ref, order total) → capture → receipt on both sides. Today's log stays.
  - [ ] 8.2.b **No offline redemption.** With no network the counter says "Can't redeem offline — try again when connected" and queues nothing; delete the pending queue. The BFF calls the voucher service in device mode (4.5.c). Delete the client-side catalogue of every merchant's vouchers and the unsigned device cookie (D16).
  - [ ] 8.2.c A counter device can never void or refund.
  - [ ] 8.2.d Move the merchant and provisioning copy into `messages/*/merchant.json`, and delete `merchant-copy.ts`, `merchant-error-copy.ts` and `provisioning-copy.ts`. One language per screen, from the device locale, with no bilingual stacking. The lint rules become errors for `features/merchant`.
  - [ ] 8.2.e **Check:** a voucher bought in 6.6 is redeemed at a counter on staging, and the user's wallet shows it as redeemed.
- [ ] **8.3 Client SDK and developer page** · needs: 4.5, 4.6
  - [ ] 8.3.a Studio → Developers: issue, rotate and revoke merchant HMAC credentials (4.5.d), with a sandbox credential per business. A documentation page covers the signing spec, authorize / capture / void / refund, errors and idempotency.
  - [ ] 8.3.b `packages/sdk-merchant`: a small TypeScript SDK that signs requests and calls authorize / capture / void / refund, with retries and idempotency keys, plus an example script.
  - [ ] 8.3.c Webhooks: signed `voucher.captured`, `voucher.refunded` and `voucher.expired` events to a URL the business registers, delivered by a worker job with retries (simulated on staging).
  - [ ] 8.3.d **Check:** the example script authorizes and captures a sandbox voucher in AUD and in IDR, and verifies a webhook signature.
- [ ] **8.4 snap-app integration** · needs: 8.3, 4.4, 5.4
  - [ ] 8.4.a `POST /api/partners/actions {user, action: receipt_scanned, external_ref, evidence}`:
    - authenticated with the partner HMAC credential only;
    - `user` comes from the link code (5.4.c);
    - the receipt hash is unique per (partner, hash);
    - it grants through `grantAction` from the region's marketing allocation at the F12 rate and cap;
    - set `ActionReceiptScanned.MarketingFunded = true`.
  - [ ] 8.4.b **Check:** a simulated snap-app in e2e links an account, earns receipt points, and redeems a voucher, in both regions.

**Done when:** store staff redeem vouchers on a paired device; a brand can integrate authorize and capture from the SDK and docs alone; and a simulated snap-app earns and redeems through the documented APIs.

## Phase 9 — Staff console · Area C · ~5d

The internal team runs the economy and the review queues. Today none of it exists.

- [ ] **9.1 Staff shell and access** · needs: 1.5, 3.5
  - [ ] 9.1.a A `(staff)` route group at `/staff`, using StudioShell. Staff accounts are created by CLI (`pnpm staff:add <email> <role>`). Every action is audited. All copy lives in `messages/*/staff.json`.
  - [ ] 9.1.b **Check:** a non-staff account gets 403 on `/staff/*`.
- [ ] **9.2 Moderation queue** · needs: 9.1, 7.3, 7.7
  - [ ] 9.2.a The queue covers campaign creative, question banks (checked for PII and prediction questions), audience and category (confirm or change, per the 1.1.d policy), listings and voucher batches. The simulated automated screen shows as flags. Approve or reject with a reason.
  - [ ] 9.2.b **Check:** a submitted campaign goes live only after approval and then appears in `GET /api/feed`, and a rejection shows its reason in Studio.
- [ ] **9.3 Businesses** · needs: 9.1, 7.1
  - [ ] 9.3.a KYB review (approve or reject documents, setting `is_verified`) and business suspension.
  - [ ] 9.3.b **Check:** approving KYB unblocks submit, and a suspended business's campaigns leave the feed.
- [ ] **9.4 Users and support** · needs: 9.1, 4.7, 10.1, 10.4
  - [ ] 9.4.a Search users and view their ledger history.
  - [ ] 9.4.b Suspend into **escrow** (never zero a balance), and release.
  - [ ] 9.4.c Goodwill through `grantAction(goodwill)`, marketing-funded, within the F12 per-case limit.
  - [ ] 9.4.d Change trust tier, the manual-review queue from 10.4, and the K13 dispute queue for captured vouchers (4.7.c).
  - [ ] 9.4.e **Check:** a suspension moves available and pending points to escrow, and a K13 dispute resolves with a recovery line (10.1).
- [ ] **9.5 Economy** · needs: 9.1, 4.9
  - [ ] 9.5.a Show, per region: coverage; daily issuance, burn and breakage; the reserve; the reported spread (purchase cash − granted points × B); and point purchases.
  - [ ] 9.5.b Rate changes (B and P_issue) through `proposeRate` / `approveRate`, requiring a second staff member. B is never shown outside this screen.
  - [ ] 9.5.c `fundMarketing` (two-person), kill switches, and recording a manual point purchase (bank-transfer reference → ledger purchase, two-person).
  - [ ] 9.5.d **Every F12 setting is editable here** (ceilings, caps, streak, receipt, holdback tiers, cohort floors, Open Viewing limits), as is the **points expiry policy per region, off by default** (F2).
  - [ ] 9.5.e **Check:**
    - a rate change needs a second approver;
    - changing the AU daily cap changes what RiskGate enforces;
    - coverage matches the ledger.
- [ ] **9.6 Settlement** · needs: 9.1, 10.1
  - [ ] 9.6.a Weekly statements, disputes and payout approval.
  - [ ] 9.6.b **Check:** an approved statement produces one simulated payout after the dispute window.

**Done when:** a staff member can approve a campaign and a business, suspend a user into escrow, resolve a voucher dispute, change a rate with a second approver, and adjust any economy setting per region, all on staging.

## Phase 10 — Settlement, lifecycle & risk · Area A · ~5d

- [ ] **10.1 Clearing & settlement** · needs: 4.6, 4.7
  - [ ] 10.1.a A worker job posts each `capture_outbox` row to the ledger with idempotency key = capture ID: voucher liability → merchant payable, at ceil(S × captured ÷ face value), capped so the total never exceeds S. Test: Σ captures = Σ payable postings.
  - [ ] 10.1.b A weekly statement per partner per region: opening payable + captures − refunds − K13 recoveries = amount payable. Point purchases appear as information lines only, never netted (J1). It is reproducible from ledger entries, exportable as CSV, and takes an explicit [from, to) period.
  - [ ] 10.1.c `approvePayout`, after the dispute window (F12), leads to a simulated payout: merchant payable → reserve. A single-use remainder, an expiry or a dead hold releases the remaining voucher liability.
  - [ ] 10.1.d **Check:** a week of simulated activity produces statements that match a recomputation from ledger entries, and after payout the reserve and payable both drop by S.
- [ ] **10.2 Expiry: built, off by default (F2)** · needs: 4.4
  - [ ] 10.2.a `last_activity_at` is a column on the user's ledger points account, written inside every grant and burn transaction. Points expiry reads the per-region policy (9.5.d), **off by default**. When on, it posts breakage with the key `expire_<account>_<last_activity_at>`, skips escrow, and emits `ledger.points_expiring` 30 and 7 days before.
  - [ ] 10.2.b A voucher expiry job covers active vouchers and dead holds, and emits `voucher.expired`.
  - [ ] 10.2.c **Check:** with expiry off, nothing expires. With it on for a test region, an account clock-shifted 12 months posts breakage once, and an escrowed account does not.
- [ ] **10.3 A daily proof that means something** · needs: 4.6
  - [ ] 10.3.a Record the proof after day close with a grace period, refusing today and future days. Verify every proved day. Write the roots to an append-only store outside the database (a simulated bucket driver). Include allocations, grants, purchases, rates and the voucher heads in the leaves (EM-07, EM-24).
  - [ ] 10.3.b A exposes `GET /api/proof/roots`. (requested by A) B builds `/[locale]/transparency` in `(public)` under 11.3, listing each day's root so anyone can verify later (F11, without a blockchain).
  - [ ] 10.3.c Alerts go through a simulated pager, with a "hasn't run" check for every scheduled job.
  - [ ] 10.3.d **Check:** tampering with one past ledger entry or voucher event fails verification, and the page shows the root.
- [ ] **10.4 Risk rules v1** · needs: 4.4, 5.1
  - [ ] 10.4.a A real `RiskGate` replaces `AlwaysAllow` (`engine.go:62`). It checks velocity per user, device and IP; timing plausibility (answers that come too fast); impossible flows; and the daily and monthly caps (F12).
  - [ ] 10.4.b Trust: every tier earns the full terms (F13); the tier sets only the holdback (F12). Tier promotion follows F12. Flags go to the manual review queue (9.4), and a suspension moves the balance to escrow.
  - [ ] 10.4.c Delivery-log cross-check (EW-18): a worker job loads the nginx log into `platform.delivery_log`, and `deliveryCoverage(sessionId)` says whether the signed segments served cover the claimed coverage. B's completion (5.3) calls it; a gap flags the session for review and never fails it silently.
  - [ ] 10.4.d **Check:** a scripted farming account is flagged and its pending points are held, and a tier-0 account's grant unlocks after 72 h.

**Done when:** a week of simulated activity produces statements that reproduce from the ledger; expiry does nothing until it is switched on; the proof, solvency and risk jobs run and alert.

## Phase 11 — Public site · Area B · ~3d

- [ ] **11.1 Landing page and chooser** · needs: 3.5, 7.2.e, 7.7
  - [ ] 11.1.a `/` becomes a public landing page, with logged-in visitors sent to `/home`:
    - a hero with real campaign video;
    - how it works in three steps;
    - a "for businesses" section, following the Phase 3 copy rules;
    - a crawlable region and language chooser with no IP redirect, AU first, plus `x-default`.
  - [ ] 11.1.b A logged-out For You feed of Open Viewing teasers on `/au` and `/id`.
  - [ ] 11.1.c **Check:** a logged-out visitor sees the landing page in English; a logged-in one lands on the feed.
- [ ] **11.2 Real data** · needs: 7.7
  - [ ] 11.2.a `/au` and `/id` read the API with revalidation. **Channel pages live at the existing `/[locale]/m/[handle]` route** (keyed by business handle), and campaign pages stay at `/[locale]/c/[campaignId]`.
  - [ ] 11.2.b Open Viewing (F8): only campaigns with `openViewing` that are rated all_ages play logged-out through a **non-earning anonymous watch session**, which returns the same per-session signed manifest URL as 5.1.d and counts against the F12 per-IP limit. `/media/hls/` never becomes public. Other campaigns show their poster and terms with "Sign in to watch". Sign-up returns to **the same campaign**; today it lands on a different, synthesised one.
  - [ ] 11.2.c **Check:** a campaign created in Studio appears on the public page without a rebuild, and an adult-rated campaign cannot be played logged-out.
- [ ] **11.3 SEO and trust pages** · needs: 11.2
  - [ ] 11.3.a Help / FAQ, how points work, for business, and terms and privacy (marked draft on staging). A branded 404 and branded OG cards.
  - [ ] 11.3.b `VideoObject` JSON-LD, sitemap and robots fixes (`/id/` rather than a bare `/id` prefix, and a configurable site URL), and `llms.txt`. Everything is `noindex` while `APP_ENV=staging`.
  - [ ] 11.3.c (requested by A) `/[locale]/transparency`, listing each day's root from `GET /api/proof/roots` (10.3.b).
  - [ ] 11.3.d **Check:** a crawl of staging finds no broken links and no page without a title or description.

**Done when:** a logged-out visitor lands on a real, video-led page in English, can watch an opted-in campaign without earning, and signing up brings them back to that same campaign.

## Phase 12 — Teen & family mode · Areas A + B + C · ~3d

**Founder decision 2026-09-25 (F4), reversing C4 ("18+ only"):** teens aged 13–17 get their own age-appropriate YourTal, like YouTube Kids. It suits companies that sell to teenagers (games, books). Products for young children (strollers and the like) are aimed at **parents**, who are adult users; under-13s never get accounts. Teen mode is built fully and switched on in staging for review. It is switched on for real minors only after the legal review in 12.4. The platform is already free of user-to-user interaction (Phase 3), so teens need no special handling there.

- [ ] **12.1 Guardians and enforcement** · A · needs: 1.4, 1.5, 10.4
  - [ ] 12.1.a Register a 13–17 account (1.4.b), and the guardian email carries approve and revoke links to `/guardian/[token]`. B builds that page (12.2.c). Revoking sets the teen back to restricted and escrows its balance. A pending teen may browse teen and all_ages campaigns but cannot start a reward session.
  - [ ] 12.1.b The Cerbos `campaign_view` and `listing` policies deny when the resource's audience is not allowed for the principal's `ageBand` (1.1.c). Every read, watch start, checkout, notification, search and public page is gated in one place.
  - [ ] 12.1.c The teen cap from F12 goes into `RiskGate`. Minors get declared interests only, never inferred ones.
  - [ ] 12.1.d Turn `TEEN_ACCOUNTS` on for `APP_ENV=staging`, in the same merge that passes this task's Check.
  - [ ] 12.1.e **Check:**
    - a 14-year-old registration waits for approval, and calling the guardian link's approve endpoint activates it (HTTP round trip);
    - an adult-only campaign is denied to a teen principal on every endpoint;
    - a teen's grant above the cap is refused.
- [ ] **12.2 Teen feed and experience** · B · needs: 12.1, 7.7
  - [ ] 12.2.a Teen items get the 1.1.c ranking boost, and teen accounts see only teen-relevant interests (games, books, school supplies, sportswear, streaming, cinema).
  - [ ] 12.2.b Softer engagement:
    - no streak counter and no loss-framed or at-risk messages;
    - a daily-cap meter;
    - quiet hours in the profile's timezone (F12);
    - a watch-time reminder;
    - teen-appropriate vouchers only.
  - [ ] 12.2.c (requested by A) `/guardian/[token]`: the guardian confirms they are 18 or over and approves; the same link later revokes. There is no guardian account.
  - [ ] 12.2.d **Check:** a teen demo account gets no notification between 21:00 and 07:00 in its timezone and sees only teen and all_ages items.
- [ ] **12.3 Studio and data** · C · needs: 12.1, 7.6
  - [ ] 12.3.a Audience and category pickers with the 1.1.d policy shown. Teen-rated question banks may not ask personal questions.
  - [ ] 12.3.b Reports apply the teen cohort floor (F12), with no teen breakdown below it.
  - [ ] 12.3.c **Check:** a report for a campaign with fewer than 20 teen viewers shows no teen breakdown.
- [ ] **12.4 Legal review (not engineering)** · founder
  - [ ] 12.4.a Counsel reviews teen mode.
    - **AU:** Privacy Act child provisions and the coming Children's Online Privacy Code, the AANA code on advertising to children, minors' contractual capacity, and the under-16 social media law.
    - **ID:** PDP Law parental consent for children's data, and the child-protection regulation for electronic systems.
    
    Then update `docs/24` (AU-9, ID-12) and `docs/16` (C4). Until this is done, `TEEN_ACCOUNTS` stays off outside staging.

**Done when:** on staging, a 14-year-old demo account (approved by a guardian through the inbox) sees only teen-rated and all-ages campaigns and vouchers, a parent demo account sees campaigns for young children's products, and an adult-only campaign never reaches a teen through any endpoint.

## Phase 13 — Ready for live review · All areas · ~3d

- [ ] **13.1 The demo world** · C (A does the ledger part) · needs: 7.2, 7.3, 7.4, 8.1, 4.7, 9.1, 10.1, 12.1
  - [ ] 13.1.a `pnpm demo:reset`, **on demand** (a CLI and a staff button), never deleting or editing ledger, voucher or proof rows: it suspends the current demo accounts, reverses their balances with postings, and creates fresh demo accounts with new IDs. It covers AU (the default) and ID. Each region gets:
    - snap-app plus about 6 fictional brands: café, fashion, games and books for teens, kids' products for parents, fitness, electronics;
    - about 24 campaigns from the demo media kit, with rewards per F12 across audiences and lengths from 45 s to 15 min, including **≥ 8 teen** and **≥ 4 parents** campaigns;
    - vouchers for every brand, including ≥ 6 teen listings;
    - demo accounts for every role: adult viewer (tier 3), teen plus guardian, business owner, marketer and finance, a store counter device, and staff admin, moderator and finance.
  - [ ] 13.1.b A week of history, made by driving the **real APIs** over a real period and never by raw SQL into the ledger (A's `seed/ledger.ts`), so reports and statements have data.
  - [ ] 13.1.c **Check:** after `pnpm demo:reset`, every demo login works and every screen has data in both regions.
- [ ] **13.2 Review guide** · B · needs: 13.1
  - [ ] 13.2.a A `/review` page, on staging only, listing the viewer, teen and guardian, business and counter demo logins. **Staff logins are not listed**; they are given to the founder separately from `app.env`. It also lists the journeys to try with direct links, `/dev/clock` for time-based journeys, and what is simulated.
- [ ] **13.3 End-to-end tests, split by owner** · needs: 13.1
  - [ ] 13.3.a **B:** journeys 5, 6, 7, 11 and 14 (`product-intent.md` §2.2), in AU and ID, in `e2e/journeys/`.
  - [ ] 13.3.b **C:** journeys 1, 2, 3, 4, 8 and 12.
  - [ ] 13.3.c **A:** journeys 9, 10 and 13, a test that fails if the production build ever resolves `mock`, and an authorization matrix test covering every role against every route and region.
- [ ] **13.4 The quality bar** · B + C · needs: 13.1
  - [ ] 13.4.a Performance on a mid-tier Android profile: LCP ≤ 2.0 s, initial JS ≤ 200 KB, TBT ≤ 200 ms, and **time to first frame on the feed ≤ 1.0 s** (docs/08).
  - [ ] 13.4.b Axe clean on every route, no horizontal scroll at 320 px, light and dark both checked, and captions present on every demo campaign.
  - [ ] 13.4.c **Check:** the Lighthouse CI mobile run meets the budgets on `/home` and `/au`.
- [ ] **13.5 Security and red lines in code** · A (with requests to B and C) · needs: 13.1
  - [ ] 13.5.a Rate limits on public endpoints, a session and cookie review, CSP, gitleaks in CI (the repo is public), and a dependency audit.
  - [ ] 13.5.b Tests that keep the red lines in code:
    - **#1** no prediction questions (7.3.b);
    - **#4** the user role is denied every purchase path, and `userPointPurchaseEnabled` stays literally false;
    - **#6** no sensitive interests (1.1.e);
    - **#7** unverified businesses cannot submit (7.3.d);
    - **#10** reports are aggregates only (7.6).
  - [ ] 13.5.c Delete `money/mock-backing-rate.ts`, drop `pointsPriceFromSettlement` from the exports, remove the bundle-test allowlist (4.9.d), and delete `formatPoints` once `git grep 'formatPoints('` is empty.
  - [ ] 13.5.d **Check:** gitleaks and the audit are green in CI, and each red-line test fails when its guard is removed.
- [ ] **13.6 Founder walkthrough** · founder · needs: 13.2
  - [ ] 13.6.a Walk through `/review` on staging. Every issue becomes a task in this file, either in Phase 13 or in a new Phase 14.

**Done when:** the founder completes the walkthrough on staging, and every issue raised is either fixed or recorded as a task in this file.

---

## Not in this plan (deferred)

These come after the finish line, per `docs/audit/2026-09-25/product-intent.md` §7:

- **Advertising and payments:** self-serve advertiser acquisition and an LLM copilot; prepaid card billing and post-paid credit; clearing automation; Open-View billing; a paid recall tier; OM SDK / MRC.
- **ML:** interest inference, completion prediction, fraud scoring, live LLM moderation.
- **Commerce:** physical merchandise and shipping; NIB automation; Shopify / Woo plugins and a hosted widget; voucher gifting and transfer, resale, charity, cash-out and prize draws.
- **Economy tools:** the dynamic price multiplier; a full economy dashboard beyond 9.5.
- **Platform:** OIDC for sister apps; phone OTP, passkeys and a Capacitor wrap; cross-app points beyond snap-app; two-region cloud; ClickHouse and Kafka.
- **Growth:** telco zero-rating and WhatsApp; the referral programme; programmatic backfill.
- **Real vendors** (payments, email, SMS, KYB), each a driver swap.
- **Other:** offline counter redemption; question leak detection; the coverage map; surveys, offerwalls and mini-games; anchoring the daily root on a public blockchain.

## Before the first real user (outside "finished")

- **F9:** someone owns the economy numbers, and confirms the F12 defaults.
- Helios for production is acceptable (F2), but check the APP 8 position for Australian personal data with counsel.
- Minimum ages cited in `docs/24` (AU-9, ID-12), and the teen-mode review (12.4).
- Counsel reviews `docs/24` ID-1 with expiry off (F18): points are then loyalty, not e-money, on three legs rather than four.
- The founder re-signs the risk acceptance.
- Entities: an AU Pty Ltd and an ID PT.
- PSE registration (ID).
- Counsel review before the AU launch, including whether AU gift-voucher minimum-expiry rules apply.
- A rehearsed 72 h breach runbook (docs/24 ID-8 / AU-6).
- AU reaction sessions (`docs/23` §2.6).
- Real vendor contracts and the driver swaps.
- Merchant contract clauses (K10, K13, K14, B8, J5).
- Support staffing.

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| **Phase 4 (the bank) and Phase 3 (design) are the long poles** | The 1.2 fakes with real semantics let other phases proceed. Phase 4 is ordered to replace the fakes early. F3 defaults after 24 h. |
| **Several sessions on one repo** | One phase per session, in slot worktrees with their own databases and ports; fast-forward-only merges; `needs:` on every task; additive-only shared files; the wave table says what may run together. |
| **Design taste stalls the reskin** | The founder judges motion captures, not screenshots. Token names are fixed, so a later change of mind only swaps values. |
| **Farming on an open staging site** | Money there is simulated. 5.1, 4.4.d, 10.4 and signed segments close the known exploits. Staff logins are never published. |
| **Helios is shared** with about 30 client sites | Loopback only, the `yourtal.slice` CPU and memory caps, and nightly backups including the keyring. |
| **Legal exposure from teen mode** | Flag off outside staging until 12.4. No social features anywhere. Guardian consent from day one. |
| **A public repo** (F6) | Role passwords are set on Helios from secrets, gitleaks runs in CI, and the security gaps listed in the audit close in Phases 1, 4 and 5. |
| **A quota cut-off mid-task** | Commit at every clean boundary; the worktree keeps whatever is uncommitted. |

## Log

Newest first. One line per finished task: `2026-09-25 · A · 0.1 Land the plan · 1a2b3c4`.

- 2026-09-25 · A · 0.6 The docs tell the current story: README, docs/16 section U, docs/24–25 on main and amended, and a sweep of 11 docs · 3a097c2
- 2026-09-25 · A · 0.5 A first visit is English: AU by default, merchant `lang` from the device, player and earn-board copy from the catalogues · 3d166a2
- 2026-09-25 · A · 0.2 Three slot worktrees run web, api and Cerbos side by side on their own databases; a migration in one leaves the others alone · efffeda
- 2026-09-25 · A · 0.3 HEAD compiles: store, web, seed and voucher service on `*_minor` + currency; migrations apply again; voucher `/healthz` 200 · d9762ae
- 2026-09-25 · plan · Sessions now run one phase each, in slots 1–3; the Running order table says which phases can run together
- 2026-09-25 · A · 0.8.d–e MinIO on a maintained fork pinned by digest, Zitadel removed, Dependabot on · 163f309
- 2026-09-25 · A · 0.8.c Go advisories to zero (chi 5.3.2 without RealIP, x/text 0.42.0, go1.26.8) · e0d8f1c
- 2026-09-25 · A · 0.8.a–b npm and pnpm advisories to zero (`pnpm audit` clean), pnpm 11.27.1 · 32787de
- 2026-09-25 · A · 0.8.h Hygiene: .gitignore gaps closed, raw NUL bytes escaped · 7fdae87
- 2026-09-25 · A · 0.1 Plan landed, leftovers saved to wip/leftovers-2026-09-22 (2e413c7), main fast-forwarded, not pushed · fbd26c0
- 2026-09-25 · plan · Final check folded in (founder answers F13–F16, FA1; engineering calls: A restarts in its worktree after 0.2.b, C starts after 1.3.a–b, the rendered UI gate runs in verify and CI)
- 2026-09-25 · plan · Plan written from the audit, revised after five critics and the founder's answers (F1–F12)
