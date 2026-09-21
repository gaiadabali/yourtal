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
`review` · P1 · adplatform · 5d · dep: YT-0100, YT-0031

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
`todo` · P1 · watch · 5d · dep: YT-0120

- [ ] Per-checkpoint signed single-use token; nonce burned in Redis
- [ ] Checkpoint timestamps chosen server-side and randomised per user
- [ ] Short TTL; a replayed or expired token is rejected and logged

### YT-0122 · Checkpoint delivery and answer capture
`todo` · P1 · watch · 5d · dep: YT-0121, YT-0102

- [ ] Per-user random subset from the bank, shuffled options, per-question timer
- [ ] Response latency and input entropy recorded as risk signals
- [ ] Answers stored against the campaign, never exposed per-user to the business

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
- [ ] ~~Reward accrues per checkpoint, back-loaded toward completion~~ — **superseded by decision O-1 below**
- [ ] ~~Abandoning mid-way keeps what was earned~~ — **superseded by decision O-1 below**
- [ ] Accuracy bonus applied once at the end, idempotently

### YT-0125 · Answer-key leak detection
`todo` · P1 · watch · 4d · dep: YT-0122

- [ ] Per-question population accuracy tracked over time
- [ ] A sudden accuracy jump auto-retires the question and flags the cohort
- [ ] Answer-pattern clustering identifies accounts answering identical subsets identically

## Open Viewing

### YT-0207 · Open Viewing: anonymous full-campaign playback
`todo` · P1 · watch · 4d · dep: YT-0120, YT-0205

- [ ] Anonymous session plays the full video with no checkpoint tokens issued
- [ ] Code path never touches the Reward Engine or the ledger
- [ ] Questions offered but optional, and never counted toward any reward
- [ ] No mechanism exists, anywhere, to claim a reward for an open view afterwards

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
