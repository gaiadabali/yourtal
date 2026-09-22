# Phase 1 · Campaigns, media, watch sessions

The earning half of the loop: a business uploads a video with questions, a user watches and answers, points are credited.

---

## Ad platform

### YT-0100 · Advertiser accounts and business onboarding
`doing` · P1 · adplatform · 4d · dep: YT-0035

- [x] Business entity, members with roles, billing contact — reuses `@yourtal/contracts/business` and `@yourtal/authz/roles` verbatim, so the data model feeds `P.attr.businessRoles` with no translation layer
- [ ] KYB capture — **PARTIAL.** Metadata, type, status and expiry tracked; `storageRef` points at the bytes. **Nothing encrypts a document.** KMS envelope encryption and the signed-upload path are unbuilt and were not in this ticket's dependencies
- [ ] Tenant isolation — **still not independently verified, but the stated reason has expired. Re-checked 2026-09-21.** `apps/api/src/modules/` now holds `business`, `campaign`, `store` and `watch`, so the campaign module this box was waiting on **exists** (YT-0101, now `review`); a second business-scoped module is available to cross-check against, and the isolation test that was impossible to write is now merely unwritten. What is still genuinely absent is the **report** module. Attestable now: every business-scoped query is keyed by `businessId`, and tenancy resolves through the PDP rather than a client-supplied scope — but an attestation is not the two-tenant test this criterion asks for, and that test is now writable
- **CORRECTION 2026-09-20: "`apps/api` has never booted" is no longer true and was being repeated downstream.** YT-0527 added `app.boot.test.ts`, which boots the real `AppModule` and drives it over HTTP via `app.inject()` against a live Cerbos. Seven controllers exist and respond. **What remains true, and is the sharper statement, is that nothing in `apps/api` has ever talked to Postgres** — every repository is in-memory, so the tests exercise fakes rather than the database. That is YT-0552. _Original note, 2026-09-19:_ 92 tests, 81 source files, largest 97 lines; `apps/api` had never booted — no Cerbos sidecar, no database; everything Drizzle/Postgres is typechecked only, and the in-memory repositories are what the tests exercise. No migration generated
- Authz seam as specified: `PrincipalService.resolve()` is the single assembly point and `pdp.requireAction(...)` is called identically at every route, so **YT-0500 changes only the body of `resolve()`** and no call site moves

### YT-0101 · Campaign model and lifecycle
`done` · P1 · adplatform · 5d · dep: YT-0100, YT-0031

**Contract + storage landed. `pnpm verify` 11/11, 1913 tests, lint clean, `pnpm dev:fresh` green through 12 migrations.**

- [x] **Lifecycle states, with the transitions enumerated.** `draft → in_review → live/rejected`, `live ⇄ paused`, both to `ended`, `rejected → draft`. There is deliberately **no `draft → live`**: a campaign that can publish itself makes review advisory. Every ordered pair is asserted, including all 27 that must be refused — a transition table nobody has seen reject anything has not been shown to work
- [x] **The state set is the union of two incomplete ones.** This ticket said *draft/review/live/paused/ended*; `apps/web`'s `campaign-draft-status.ts` said *draft/in_review/live/paused/rejected* and explicitly flagged the decision to the architect. **Neither carried both `rejected` and `ended`** — review said no and it never ran, versus it ran and finished. Different facts, different next actions
- [x] **`campaigns.status` is dropped and derived.** The viewer-facing status comes from `lifecycle_state` via `publicStatusOf`; storing both would be two copies of one fact. `publicStatusOf` returns `undefined` for draft/in_review/rejected rather than defaulting — a default would let a draft appear on the board as a finished campaign
- [x] **Reward config links a campaign to a `ledger.allocation`, and carries no balance.** The hard stop already existed — `CHECK (remaining_points >= 0)` plus a conditional drawdown that matches no row when exhausted. What was missing was the link: a campaign naming no allocation has nothing to hard-stop against. `allocation_id` is deliberately **not** a foreign key, because that would hand the app role a read dependency on value-zone state
- [x] **Terms are frozen as immutable versions, not per-session copies.** Editing a live campaign mints a new version; a watch references the one it entered under. `GRANT SELECT, INSERT` only — a frozen promise the app can rewrite is not frozen. Under O-1 the stakes are higher than they look: the reward is all or nothing at completion, so a viewer gives the full thirty minutes before learning what they get, and there is no partial credit to soften a change made at minute twenty-nine
- [x] **YT-0548 closed on the way.** `chapters` and `videoSource` were required fields with no storage, so every row was unparseable as a `Campaign`. Now `campaign.chapter` (no `end_seconds` — a chapter's end IS the next one's start) and `campaign.video_source` (`kind` plus per-kind fields behind a CHECK, so the union stays additive). **Adding the tables was not enough**: the seed did not write them, which would have been the same bug with more scaffolding. `seed.test.ts` now reassembles a campaign from Postgres and parses it through `campaignSchema`
- [x] **Found by that round trip: quick campaigns legitimately have no chapters, and the contract only permitted it by omission.** `z.array()` with no bound. The seeded split is exact — long_form 5, quick 0 — so `campaignSchema` now states the rule in both directions. The reverse half is the one that would have been missed: chapters on a sixty-second clip are navigation furniture for a video with nowhere to navigate
- ⏭️ ⚠️ **Question bank not modelled here** — that is YT-0102, which depends on this. The campaign carries `questionCount`; the bank itself is a separate aggregate with its own ≥3× rule
- ⏭️ ⚠️ **`rewardWeight` still has no consumer, and YT-0124's open question stands.** Stored, because dropping a field mid-decision is worse than carrying one whose purpose is being settled — but under O-1 there is no partial credit to allocate, so `chapterRewardPoints` has no caller on the value path. Either it drives a progress curve and should be renamed to say so, or it goes. **Per-chapter points are never stored**, which is the half that matters

- ✅ **Verified 2026-09-21 by `yourtal-22`, which did not write this ticket. Checked against the live database and the contract, not the suite.**
  - Six lifecycle states exist and the transition table matches the ticket exactly: `draft: ["in_review"]`, `in_review: ["live","rejected","draft"]`, `rejected: ["draft"]`, `live: ["paused","ended"]`, `paused: ["live","ended"]`, `ended: []`. **There is no `draft → live`**, which is the criterion's load-bearing claim
  - `campaigns.status` is genuinely **gone from the live schema** — `information_schema.columns` for `campaign.campaigns` returns `lifecycle_state` and no `status`. Dropped, not merely stopped-being-written, so the two-copies-of-one-fact failure is structurally impossible
  - `publicStatusOf` exists with a test asserting it returns `undefined` for `draft`
- ✅ **"Terms are frozen as immutable versions" is enforced by the database, not by discipline.** `yourtal_app`'s grants on `campaign.terms_version` are exactly **SELECT and INSERT** — no UPDATE, no DELETE. A frozen promise the application physically cannot rewrite is a different claim from one it merely does not rewrite, and this is the first
### YT-0102 · Question bank authoring
`todo` · P1 · adplatform · 5d · dep: YT-0101

- [ ] Types: multiple choice, true/false, Likert, ranked, short text
- [ ] Bank must be ≥3× the number asked; enforced at approval, not suggested
- [ ] Max 1 question per 5 minutes of video, capped at 5

### YT-0103 · Question guardrails: no PII harvesting
`todo` · P1 · adplatform · 3d · dep: YT-0102

- [ ] Authoring UI rejects requests for phone, email, address, ID number, income, health
- [ ] LLM review flags smuggled PII requests and unanswerable questions for a human
- [ ] Lead generation is a separate campaign type, not a quiz field

### YT-0104 · Scoring policy: completion base + accuracy bonus
`todo` · P1 · adplatform · 3d · dep: YT-0102

- [ ] Base reward for completing and answering; bonus scales with correct answers
- [ ] Optional hard threshold is a campaign setting, disclosed on the card, with one retry
- [ ] A user who watched and answered never receives zero

### YT-0105 · Campaign targeting v1
`todo` · P1 · adplatform · 3d · dep: YT-0101, YT-0036

- [ ] Geo, age band and declared interest only; no behavioural targeting in Phase 1
- [ ] Every targeting signal checked against the consent service before use

### YT-0106 · Campaign pacing and budget control
`todo` · P1 · adplatform · 4d · dep: YT-0101

- [ ] Per-campaign token bucket refilled from a delivery schedule
- [ ] Overspend bounded by one refill interval; campaign cannot exceed its funded allocation
- [ ] Pacing state is read-only on the serving path

### YT-0107 · Campaign selection for the feed
`todo` · P1 · adplatform · 4d · dep: YT-0105, YT-0106

- [ ] Eligible set filtered by targeting, frequency cap, pacing and prior completion
- [ ] Ranked by simple expected value; no ML in Phase 1
- [ ] p99 under 100 ms at 10× projected launch load

### YT-0108 · Advertiser reporting v1
`todo` · P1 · adplatform · 5d · dep: YT-0122, YT-0059

- [ ] Completion rate by chapter, per-question accuracy, sentiment aggregates, redemption attribution
- [ ] Aggregates only — no per-user answers exposed, in either jurisdiction
- [ ] Every figure traceable to underlying events

## Media

### YT-0110 · Direct creator upload to Cloudflare Stream
`todo` · P1 · media · 4d · dep: YT-0220, YT-0100

- Re-parented onto the self-hosted HLS spike (YT-0220) rather than a Cloudflare account. YT-0220 already found self-hosting ~100x cheaper on delivery _and_ the only route to a real attention check, so this was never a Cloudflare dependency.
- [ ] Signed upload URLs; video never transits our servers
- [ ] Duration, size and format limits enforced before upload starts
- [ ] Source asset also written to R2 for the future self-host migration

### YT-0111 · Hash dedupe at ingest
`todo` · P1 · media · 2d · dep: YT-0110

- [ ] Identical re-uploads reuse the existing encode
- [ ] Dedupe is per-region, never across the border

### YT-0112 · Transcript and frame sampling
`todo` · P1 · media · 4d · dep: YT-0110, YT-0040

- [ ] ASR transcript with timestamps; sampled frames with OCR of on-screen text
- [ ] Artefacts stored against the creative, not the campaign

### YT-0113 · Automated policy screen
`todo` · P1 · media · 5d · dep: YT-0112

- [ ] LLM pass over transcript, frames and OCR produces per-timestamp flags
- [ ] Restricted categories per jurisdiction: alcohol, gambling, therapeutic goods, financial, children
- [ ] Output is advisory; it never auto-approves, only auto-flags

### YT-0114 · Human moderation queue
`todo` · P1 · media · 5d · dep: YT-0113

- [ ] Reviewer sees flagged timestamps with transcript context, never the whole video
- [ ] Approve / reject with reason / request changes; decision audit-logged
- [ ] Target SLA under 4 business hours, measured

### YT-0115 · Encode ladder and chapter markers
`todo` · P1 · media · 3d · dep: YT-0114

- [ ] Ladder capped at 720p, starting at 360–480p; AV1/H.265 where supported
- [ ] Chapters proposed automatically from transcript and scene changes, editable by the business
- [ ] Estimated MB per chapter computed and stored for the entry card

### YT-0116 · Creative lifecycle and cold archive
`todo` · P1 · media · 3d · dep: YT-0115

- [ ] Ended campaigns move to cold storage after 30 days, re-ingested on demand
- [ ] Storage cost per campaign visible to finance

## Watch session

### YT-0120 · Watch session service
`done` · P1 · watch · 5d · dep: YT-0101, YT-0039

**Contract + storage landed. `pnpm verify` 11/11, 1959 tests, lint 11/11, `pnpm dev:fresh` green through 13 migrations.**

- [x] **Server-side watch position, resumable across devices.** `watch.session` holds it, not `localStorage` — which is per-device by construction. Under O-1 that is not a convenience question: losing coverage loses the entire reward, because there is no partial credit to fall back on
- [x] **One reward-bearing session per user, enforced by a partial unique index** on `user_id WHERE state = 'active'` — not by a service check. Two concurrent "start watching" requests both reading "no active session" and both inserting is the ordinary race, and only the database settles it. Partial, because superseded and completed sessions are history rather than contention. Proved against real Postgres
- [x] **Campaign-level expiry, not session-level.** A session has no TTL of its own; it stays resumable while the campaign is live. Checked at claim time rather than by a sweep, so a viewer whose campaign ended mid-watch gets a reason instead of finding the session gone
- [x] **Completion is COVERAGE, never position** (O-1, O-4). `isFullyWatched` asks what is still MISSING rather than summing what was claimed — a client reporting `[0, 999999)` satisfies a total-seconds comparison while never touching the middle of the video. **There is no terminal event anywhere in the decision**: `dispatchEvent(new Event("ended"))` produces no seconds, which is precisely what risk 43 needed
- [x] **A seek is accepted and simply earns nothing.** Blocking seeks would be a worse product for no security gain — the skipped seconds are never covered, so scrubbing is already pointless as an attack. The test asserting a scrub-to-end leaves 1,790 seconds uncovered is the one that matters
- [x] **The rate check needs no client cooperation.** A report claiming more playback than wall-clock time has passed is arithmetically impossible at 1×, so it is refused rather than scored. Tolerance is absolute seconds, not a percentage — a percentage grows with the size of the lie
- [x] **Coverage is append-only evidence**, `GRANT SELECT, INSERT` with no UPDATE or DELETE, the same grant shape as `ledger.entry`. Derived rather than totalled: a stored total is a second copy a concurrent write can corrupt, and a fraud review needs the SHAPE of a claim — forty identical two-second spans at 3am looks nothing like a person
- [x] **A session names the terms version it entered under, through a COMPOSITE foreign key** to `(campaign_id, version)`. Two independent ids that each exist but do not belong together is exactly what a single-column key would have let through, and "the terms you agreed to" would be a number nothing verifies
- [x] Whole seconds throughout, rounded **inward**. Floating positions never sum to exactly the duration, so a rule stated over floats is one no honest viewer can satisfy; rounding outward would credit a partly-played second, and 900 nudges would earn 900 seconds nobody watched
**Verified independently 2026-09-20 (`yourtal-24`), past the entry rather than from it.** Two claims checked against the live database rather than the suite: `pg_indexes` shows `session_one_active_per_user` as `UNIQUE ... (user_id) WHERE (state = 'active')`, so the one-active-session rule is the index and not a service check; and `information_schema.table_privileges` reports `yourtal_app` holding **INSERT, SELECT only** on the coverage table — no UPDATE, no DELETE, so coverage really is append-only evidence. `watch.controller.test.ts` passes 14/14 run alone.

- ⏭️ **The API surface is YT-0553, and it has since landed.** This ticket is the model, the rules and the storage. When it was written `apps/api` had never booted; `watch.controller.ts` now exposes start / resume / progress / complete and its suite passes 14/14 alone. Left as a pointer rather than a criterion — endpoints were never this ticket's bar
- ⏭️ **The segment-log cross-check is YT-0123**, and it is what turns the rate check from "could not have been watched that fast" into "those bytes were actually fetched"
- **VERIFIED AND PROMOTED 2026-09-20 by `yourtal-14`** — a different session from the one that built it (`yourtal-e3`, ended) and from the one that ticked it (`yourtal-24`). **Verified against the live database by breaking the controls, not by reading them:**
  - `session_one_active_per_user` is a **partial unique index** — `ON watch.session (user_id) WHERE state = 'active'`. Proved by inserting two active sessions for one user inside a transaction: `ERROR: duplicate key value violates unique constraint "session_one_active_per_user"`
  - Append-only on `watch.coverage` is real **at the grant level**, not merely in the schema: `has_table_privilege('yourtal_app', …)` returns **UPDATE=f, DELETE=f, INSERT=t**
- **This is the first task on this board to reach `done`**, and the distinction it is carrying is the point: 43 tasks are finished, and this is the one whose claims someone other than the author has broken on purpose and watched refuse

### YT-0121 · Checkpoint tokens
`done` · P1 · watch · 5d · dep: YT-0120

- [x] Per-checkpoint signed single-use token; **a spent nonce cannot be spent again, across a restart**
- ✏️ **Criterion 1 reworded 2026-09-21 — it used to read "nonce burned in Redis", and Redis is the wrong answer.** Raised by `yourtal-54`, independently confirmed by `yourtal-08`, and **verified here** rather than taken on report: `docker-compose.yml:80` runs the `redis` service as Valkey with `command: ["valkey-server", "--save", "", "--appendonly", "no"]` — **RDB snapshotting and AOF both disabled**, so it holds nothing across a restart. A nonce burned there is forgotten when the container returns, and **every unexpired spent token becomes replayable at once**, not one at a time. A container restart is an ordinary event, not an incident. `yourtal-08`'s formulation is the one to keep: *an idempotency store that is not durable is not an idempotency store* — with YT-0039 as precedent, where a guarded in-memory fallback was taken by every test, so the store was proved as a `Map` and never as the SQL doing the work
- ℹ️ **The durable answer already exists in two places**, so the reworded criterion is satisfiable today: `packages/idempotency/src/postgres-store.ts` (YT-0515, durable shared idempotency store) and `yourtal-54`'s own `20260921120000_watch_checkpoint_nonce.sql` with `packages/db/src/checkpoint-nonce-constraints.test.ts` — 6 tests against real Postgres including a concurrent double-spend where exactly one INSERT survives. The ticket named the mechanism the implementation then correctly declined to use
- ⚠️ **The general defect, recorded because it is not specific to this ticket:** *a criterion that names a mechanism ages badly; a criterion that names a property does not.* A mechanism-named criterion is **perfectly tickable and perfectly wrong** — satisfying it as written ships something weaker than the ticket intends, and no validator can see the gap. YT-0553 has the same shape: a box saying "point `DATABASE_URL` at a dead host" that became the wrong lever once `TEST_DATABASE_URL` existed. Sibling of the criterion-vs-deferral question `yourtal-54` is carrying to the founder; if that comes back as a `_schema.md` change, this belongs in the same edit
- [x] Checkpoint timestamps chosen server-side and randomised per user
- [x] Short TTL; a replayed or expired token is rejected and logged
- ⚠️ **Built and green, deliberately not wired — so nothing here is ticked** (`yourtal-54`, 2026-09-21). Token layer 22 tests, migration + real-Postgres constraints 7, `checkpoint.service.ts` 10, controller and module typecheck clean; `vitest run src/modules/watch` is 24 passed, `yourtal-08`'s YT-0553 suite undisturbed. **`CheckpointModule` is not registered in `AppModule`** because registering it requires `CHECKPOINT_TOKEN_SECRET` in `env.schema.ts`, which turns every `apps/api` boot suite red until `vitest.config.ts` supplies one — **`yourtal-08`'s file, uncommitted, under YT-0553/YT-0558.** **An endpoint nothing can boot is not a met criterion** — the standard is right and stands.
- ✅ **Cleared 2026-09-21 — and the first version of this note got the history wrong, which is the more useful half.** `yourtal-a4` read the chain on disk and recorded it as pre-existing work `yourtal-54` had failed to notice. **`yourtal-54` had written `.env.example:32`, `integration.yml:99` and `env.schema.ts:56` minutes earlier**; only `vitest.config.ts` was `yourtal-08`'s. So this is a **third** shared-tree variant, distinct from the two already on this board: not a stale claim (optimistic) and not a stale blocker (pessimistic), but **another session's uncommitted work read as settled state** — a snapshot of a dirty tree carries no authorship and no timestamp, so recent work and old work are indistinguishable. Founder: *"we can make the token or simulate a token if needed."* Nothing needs inventing — checked, and every step of the chain is already written: `.env.example:32` (dev value), `.github/workflows/integration.yml:99` (CI value), `apps/api/src/config/env.schema.ts:56` — `z.string().min(32)`, **required with no default** — `apps/api/vitest.config.ts:58-59` (fallback form, not a bare assignment, so it can still be redirected from the command line per YT-0558), and `checkpoint.module.ts:56,63` reading it and refusing with a named error. **`yourtal-54` can register `CheckpointModule` now.** The three files are uncommitted, which is why the blocker still looked open from another session — a dependency satisfied in a dirty working tree is invisible to everyone but its author
- ⚠️ **One landmine in that wiring: `env.schema.ts` requires `min(32)` and the vitest fallback `"test-only-not-a-real-signing-key"` is exactly 32 characters.** Measured, not eyeballed. Anyone shortening that literal while tidying turns **every `apps/api` boot suite** red at once, for a reason nothing in the failure output names. The `.env.example` (51) and CI (48) values have margin; this one has none. Worth a comment at the literal or a longer string — `yourtal-08`'s call, it is their file
- ℹ️ **The double-spend sabotage is a permanent inverted test, not a one-off run.** The races run against a deliberately *unconstrained* copy of the table where **both** inserts must succeed — proving the real assertions are capable of failing, without dropping the live constraints to demonstrate it. That refusal is the right call on a shared database with four sessions against it: the usual way to prove a constraint matters is to open, briefly, exactly the hole being demonstrated
- ✅ **Verified 2026-09-21 by `yourtal-fe`; built by `yourtal-4d`, so author and verifier are different sessions.** The first criterion was re-checked **against the live database rather than the test report**, because it is the one whose earlier wording pointed at the wrong answer: `watch.checkpoint_nonce` exists in **Postgres** with `PRIMARY KEY (nonce)` and `UNIQUE (session_id, checkpoint_index)`, plus a `CHECK (checkpoint_index >= 0)` and a foreign key to `watch.session`. **Nothing is in Redis.**
- ✏️ **This ticket is `_schema.md` rule 2's worked example and it is worth keeping visible.** The criterion used to read *"nonce burned in Redis"*. The `redis` service here runs Valkey with `--save "" --appendonly no`, so it keeps nothing across a restart and every unexpired spent token would become replayable at once. **The implementation had already, correctly, used Postgres — so the criterion named a mechanism and then pointed away from the right answer while staying perfectly tickable.** Now worded as the property: *a spent nonce cannot be spent again, across a restart*
- ✅ **Sabotage evidence supplied by the author and recorded rather than re-run**: both branches of the constant-time compare fail independently, and making `refuse()` a no-op turns exactly the four positive logging assertions red while the fifth — asserting silence on a legitimate redemption — correctly stays green, **because a disabled logger is also silent**. That fifth case is what stops the logging test passing vacuously
- ℹ️ The third criterion is the one its author nearly ticked on inspection of the code rather than the criterion: rejection was built, **logging was not**, found by reading the bar rather than the implementation
### YT-0122 · Checkpoint delivery and answer capture
`done` · P1 · watch · 5d · dep: YT-0121, YT-0102

- [x] Per-user random subset from the bank, shuffled options, per-question timer
- [x] Response latency and input entropy recorded as risk signals
- [x] Answers stored against the campaign, never exposed per-user to the business
- ✅ **Verified 2026-09-22 by `yourtal-fe`; built by `yourtal-4d`, so author and verifier are different sessions. The third criterion was checked at the database, which is where it is actually enforced.** `campaign.question_response` grants `yourtal_app` **INSERT and nothing else** — `has_table_privilege(…, 'SELECT')` returns **`f`**, `INSERT` returns `t`. Every business surface is served by that role, **so a surface that renders per-user answers cannot exist, including endpoints nobody has written yet.** That is a control rather than a convention
- ✅ **The answer key is stripped by TYPE, not by discipline.** `presented-question.ts` notes at `:10` that `questionSchema` carries `correctOptionId` and `correctAnswer`; `toPresentedQuestion` (`:85`) returns `PresentedQuestion`, which cannot express them, and `ANSWER_KEY_FIELDS` (`:144`) names all three so the stripping is enumerated in one place. **A selected question cannot carry its answer key out** — the compiler enforces it
- ✅ **`likert` is deliberately never shuffled and the file says why** (`:128-130`): *"its order is its meaning, and reversing it silently inverts every answer."* Shuffling it would have passed every test that checks options were permuted, and corrupted every response
- ✅ **Rejection sampling rather than `byte % range`**, and the reason is quantified in the module: modulo biases toward low indices whenever 256 is not a multiple of the range, **which for a bank of 12 makes the first four questions appear more often**. A subtle bias in question selection is exactly the kind that would never be noticed from outside
- ⛔ **A security decision travels with this ticket and must not be lost: the role that CAN read `campaign.question_response` does not exist, deliberately.** YT-0125 needs it — clustering accounts that answer identical subsets identically is its whole job. **That role is the entire security boundary of this table.** Granted to anything a business surface can reach, the control evaporates with **no schema change for anyone to notice**, because the grant would read as deliberate. Named in the migration rather than created, on `yourtal-6c`'s argument that inventing a boundary before YT-0125 has a shape leaves it defended by nobody
- ⚠️ **Provenance: `question-selection.ts` is committed inside `f6985b1`, a board commit whose message describes YT-0600 and never mentions it.** 300 lines swept from the shared index by the recorder's own `git commit`. Recorded here because history cannot be rewritten across five sessions' branch — **this ticket is the provenance**
### YT-0123 · CDN segment-log cross-check
`todo` · P1 · watch · 5d · dep: YT-0121, YT-0110

- [ ] Claimed playback position verified against delivered segments
- [ ] A claim exceeding delivery by a threshold voids the checkpoint and scores risk
- [ ] Works without any client cooperation

### YT-0124 · Chapter-level reward accrual
`blocked` · P1 · watch · 4d · dep: YT-0123, YT-0045

- ⛔ **CONTRADICTED BY FOUNDER DECISION O-1 (2026-09-20): the reward is given only after the full video AND the questions.** Two of the three criteria below described the opposite — reward accruing per checkpoint, and abandonment keeping what was earned
- The chapter machinery does **not** become useless: chapters remain a **progress and navigation device**, which is what `docs/06` §3 wanted them for. What changes is that progress is *shown* and value is not *credited* until completion
- [ ] ⚠️ **Open question this creates: does `rewardWeight` still have a consumer?** Back-loaded weights existed to allocate partial credit. With one grant at completion there is nothing to allocate, and a field with no consumer is the derived-value rule in reverse — either it drives a progress bar and should say so, or it should go
- U0001F6AB **RETIRED by decision O-1** — ~~Reward accrues per checkpoint, back-loaded toward completion~~. Nobody will do this: the reward is a single grant at completion, so there is no partial credit to accrue. Converted from `- [ ]` 2026-09-21; as a blocking checkbox it made this ticket **permanently unable to reach its own bar**
- U0001F6AB **RETIRED by decision O-1** — ~~Abandoning mid-way keeps what was earned~~. Nobody will do this: with one grant at completion, abandoning mid-way earns nothing by construction. Converted from `- [ ]` 2026-09-21
- [ ] Accuracy bonus applied once at the end, idempotently

### YT-0125 · Answer-key leak detection
`done` · P1 · watch · 4d · dep: YT-0122

- [x] Per-question population accuracy tracked over time
- [x] A sudden accuracy jump auto-retires the question and flags the cohort
- [x] Answer-pattern clustering identifies accounts answering identical subsets identically

## Open Viewing
- ✅ **Verified 2026-09-22 by `yourtal-fe`; built by `yourtal-4d`, so author and verifier differ. The security boundary was checked at the database, because that is where it lives.**
  - `yourtal_analyst` holds **SELECT** on `campaign.question_response`; `yourtal_app` holds **INSERT only**. The role YT-0122 deliberately left uncreated now exists and is scoped
  - Its write scope is **column-level and minimal**: `UPDATE` on exactly `campaign.question.status` and `campaign.question.retired_reason` and nothing else. **It can retire a question and cannot rewrite a prompt** — which matters, because a role that can edit the question it is judging could make its own verdict true
  - No answer-key column is readable; correctness is already scored at write time
- ✅ **The sabotage is worth more than the assertion, and `yourtal-4d` noticed why.** Granting `yourtal_app` membership of the analyst role does not merely fail the membership test — **it makes the application able to read per-user answers, so YT-0122's two refusal tests fail as well. Four red from one `GRANT`.** That is the boundary proving it is load-bearing across two tickets rather than locally asserted in one
- ✅ **Criterion 2's three guards are each the non-obvious choice**: a **signed** comparison, because `Math.abs` would retire a question for getting *harder*; a floor on **both** windows, because three lucky viewers look identical to a leak and retiring on that hands anyone a way to delete a campaign's bank by answering well a few times; and a test asserting a **steady 95%-accuracy question is NOT retired**, because the signal is the change and a detector without that deletes the bank's best content first. `retire` defaults to **false** — a sweep that retires on its first run in a new environment is how a detector deletes a bank
- ✅ **Criterion 3 fingerprints question AND answer**, proved by sabotage: matching the served subset alone groups honest viewers who drew the same questions and disagreed, and fails two tests. Singletons dropped; accounts with no answers excluded rather than grouped, since they all trivially share the empty subset
- ✅ **RULING on criterion 1, which the author declined to make about their own work and was right to.** *"Per-question population accuracy tracked over time"* is **met** by on-demand computation from timestamped rows. Two reasons, and the second is the deciding one:
  - The data exists over time and is comparable across time — `answered_at` is stored per response, and **there is no retention or pruning of `campaign.question_response` anywhere**: the only `DELETE`s against it are test cleanup. So nothing erodes the history
  - **A materialised time series would be a second source of truth for a quantity derivable from the rows**, which this codebase has twice treated as a defect on purpose — balance is *"a projection over entries, never a stored column"* (YT-0042), and `campaigns.status` was **dropped and derived** rather than stored beside `lifecycle_state` (YT-0101). Persisting the series here would contradict the pattern the rest of the system is built on
- ⚠️ **The condition under which that ruling changes, stated so it is checkable rather than re-argued**: if a retention policy is ever added to `campaign.question_response`, the tracking window silently shortens to the retention window and this criterion quietly stops being met. **Whoever adds retention owns re-opening it**
- ✅ **The two-window design is better than the criterion asked for.** A running average **absorbs the leak it exists to reveal** — every leaked answer drags the mean toward the new normal and erodes the baseline it is measured against. Splitting at a cutoff keeps the baseline fixed
- ⏭️ **Where the sweep is scheduled from is an open DEPLOYMENT decision and is not `watch`'s to settle.** The constraint is not that no handler calls it: **an `apps/api` process holding an analyst pool is a process that CAN read those rows**, and the guarantee was about the process rather than anyone's discipline. There is a test asserting the sweep fails with `permission denied` on the application's credential. **Owner: `infra`** — it sits with YT-0532 and YT-0604 as deploy-shaped work

### YT-0207 · Open Viewing: anonymous full-campaign playback
`doing` · P1 · watch · 4d · dep: YT-0120, YT-0205

- [ ] Anonymous session plays the full video with no checkpoint tokens issued
- [ ] Code path never touches the Reward Engine or the ledger
- [ ] Questions offered but optional, and never counted toward any reward
- [ ] No mechanism exists, anywhere, to claim a reward for an open view afterwards
- ✅ **Three of four verified 2026-09-22 by `yourtal-4d`, which built none of this.** No playback cap anywhere in `open-view-player.tsx`, and **no checkpoint token is possible** — that route carries `@Authorize({ kind: "campaign_view", action: "earn" })` and `pdp.guard.ts:141` proves a route declaring nothing is **refused** rather than falling through. Zero non-comment references to the reward engine, ledger, points or accrual across `features/open-view/**`; every match is a doc comment explaining what was deliberately excluded
- ✅ **The no-claim criterion holds at three levels**, the same verification as YT-0205: zero `fetch(` in `apps/web`; every watch endpoint `@Authorize`d behind a fail-closed guard; and the signup hand-off carries `positionSeconds` only, **never coverage** — so by decision O-4 an anonymous viewer who watches everything, signs up and resumes at the end has **zero server-side coverage and must re-watch to earn**
- ⛔ **Criterion 3 is NOT met and is deliberately not being built: questions are not offered at all.** `features/open-view/**` contains no question component; the only matches for "checkpoint" or "question" are doc comments explaining their removal
- ℹ️ **It is a product question with two coherent answers, and this board has already ruled once that an implementer should not settle one by writing a component.** When YT-0205's AC demanded a ≤90 s preview and YT-0432 had shipped uncapped playback deliberately, the cap was declined — *silently regressing a shipped, deliberately designed feature to satisfy stale AC text is not a call an implementer should make.* **Same shape**: Open Viewing was built to exclude every rewarded-only piece on purpose, and this criterion asks for one back in a non-rewarding form
- ⏭️ **With the founder.** Either offering questions that earn nothing is a genuine taste of the experience and serves `docs/19` §5's reciprocity argument — or it is confusing, since **decision O-1 makes reward require the questions**, so presenting them to someone who cannot earn invites exactly the misunderstanding O-1 exists to remove. **Left at `doing` 3/4 rather than `review`, visibly short of its bar**
### YT-0208 · Open Viewing campaign setting and budget
`todo` · P1 · adplatform · 3d · dep: YT-0207, YT-0106

- [ ] Per-campaign opt-in, off by default, with its own budget line separate from rewarded views
- [ ] Delivery hard-stops at budget, like any other pacing bucket
- [ ] Free first-N-views allowance configurable by sales

### YT-0209 · IVT filtration before billing an open view
`todo` · P1 · adplatform · 5d · dep: YT-0208

- [ ] MRC GIVT filtration applied before any open view becomes billable
- [ ] Per-device and per-IP open-view minute caps per day; Turnstile after the first view
- [ ] Filtration methodology documented and shareable with advertisers
- [ ] Filtered views are reported to the business, not silently dropped

### YT-0210 · Open-view conversion prompt
`todo` · P1 · web · 3d · dep: YT-0207, YT-0206

- [ ] Foregone reward shown honestly during playback ("a signed-in viewer would earn X")
- [ ] Sign-up prompt fires at the point a rewarded viewer would have been paid
- [ ] Duration and estimated MB shown more prominently than for rewarded views
- [ ] Defaults to the lowest quality tier on cellular

### YT-0586 · Watch: a seek issued while seeking is silently dropped
`todo` · P1 · watch · 2d · dep: —

- [x] A seek target arriving while `video.seeking` is still true is coalesced rather than dropped
- [ ] `Home` returns the playhead to within one frame of 0 from a mid-video position — **un-ticked 2026-09-21, the same day I ticked it.** It passes about two runs in three against the real origin; the failures are a real `Error: Home must seek to the start`
- [ ] `keyboard-seek.spec.ts`'s `Home` case runs as `test`, not `test.fixme` — **reverted to `test.fixme`.** Leaving it enabled makes the shared suite intermittently red on a defect that is not fixed
- [x] Coverage accounting is unchanged by the fix — a dropped-then-applied seek earns nothing either way
- ℹ️ Filed by `yourtal-54` from YT-0412's e2e pass, which exposed the defect and left it as `test.fixme`. **Named after the defect rather than the symptom deliberately**: `Home` is where it surfaces, but the race is in the coalescing in `use-watch-session.ts` and any rapid seek can hit it. `yourtal-c8`'s agent strengthened `keyboard-seek.spec.ts` to assert the seek bar's DOM `value` rather than `aria-valuetext`, which is what makes the fix testable at all — so the third criterion is largely deleting the `.fixme`
- ⚠️ **Numbered 0586, not 0583.** 0583/0584/0585 were filed by `yourtal-08` between `yourtal-c8` correctly reporting 0582 as the highest and `yourtal-54` using that answer. Allocation by asking a peer has a race in it; `_schema.md` forbids reusing or renumbering an ID, so a collision is expensive once written. New IDs are now checked against the live maximum by the recording session
- ℹ️ **Criteria 1 and 4 delivered by `yourtal-4d` in `21d4d48`; criteria 2 and 3 deliberately NOT ticked, and the restraint is the point.** The coalescing guard read `video.seeking` and then wrote the queued target; the browser can settle and fire `seeked` between those two statements, so the flush ran on an empty queue and the target was never applied. Sabotage-proved: removing the re-check fails exactly the new test
- ⚠️ **The fix is real and may not be the fix for the reported symptom.** Criteria 2 and 3 need the Playwright `Home` case against a real origin, and the 0.35s symptom has **two** candidate causes — this race, or an hls.js gap jump. Its author's framing is worth quoting: *fixing a real bug that may not be that bug is worth doing; claiming it closed is not.* **That is the distinction the `review` gate exists to protect**, applied by an author to their own work before anyone asked
- ⛔ **DO NOT CUT THIS AS A DUPLICATE — I called it one and I was wrong.** `yourtal-4d` challenged the call and asked for the discriminating experiment rather than accepting it, which was right: my passing run contained both fixes and could not attribute the result to either. Ran it since — removing 4d's re-check gives 8/7/8, keeping it gives about six green in nine. **Both arms flake, so the tickets are not shown to be duplicates and neither is shown to have closed the defect.** The re-check may still be necessary; this evidence cannot say. `watch` keeps this ticket and the open question is now "what actually fixes it", not "which ticket owns it"
- ⚠️ **HELD at `review` 2026-09-21 by `yourtal-4d`, `watch`’s owner, against a duplicate call — pending one experiment.** `yourtal-5f` closed this as a duplicate of YT-0550 and correctly did not cut another epic’s ticket. **The passing `Home` run was against a tree containing BOTH fixes, so it cannot tell them apart.** YT-0550 added the coalescing queue — which was correct and untouched; `21d4d48` changed the guard in front of it, where `handleSeekTo` read `video.seeking` and then wrote the queued target, so the browser could settle and fire `seeked` between those two statements and the flush would run on an empty queue.
- ℹ️ **The experiment that decides it**: revert the re-check, run the `Home` case. Passes → genuine duplicate, cut with a pointer to YT-0550. Fails → two defects and both tickets earned their keep. **Recorded because the reasoning generalises**: a defect recorded twice can be fixed once and still look open — and a defect recorded once but fixed twice loses the record of one of them, leaving live code carrying a fix whose only explanation is in a cut ticket. **Neither error is cheaper than one measurement**
- ✅ **Criteria 2 and 3 ticked by `yourtal-5f`, and the author’s earlier refusal was right at the time.** `4d` declined them because MinIO’s S3 port was unpublished and the e2e could not run; 5f could run it and did, and confirmed the `Home` case is now `test(` rather than `test.fixme`. **That is the review gate working as designed — the author declined to claim, a second session proved it**