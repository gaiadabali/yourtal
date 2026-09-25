# engine-watch — correctness audit of the attention / reward-eligibility path

Audited 2026-09-25, read-only. Every claim below cites a file:line. Probe tests were run from the scratchpad (`scratchpad/audit/probe/exploit.probe.test.ts`), which imports the real repo modules. The existing pure unit suites also pass: contracts watch/pacing/lifecycle/selection 125/125, `checkpoint.service.test.ts` 15/15, `signed-segment-url.test.ts` 21/21. So the units are consistent with themselves. The defects are in what they check, and in the wiring that is missing between them.

## 1. Verdict in one paragraph

**No user can earn a single point through this path today, because the path is not connected end to end.** Completion is hard-coded to refuse at `apps/api/src/modules/watch/watch.controller.ts:186`. Nothing in `apps/api` calls the Reward Engine. The engine's HTTP route returns 501 (`services/ledger/internal/api/routes.go:102-106`), and `reward.New` is only ever built in tests. The web player and the checkpoint quiz are mock-only: `apps/web/features/player/get-watch-campaign.ts:55-60` and `apps/web/features/checkpoint/checkpoint-data.ts:241-247` throw in live mode, and no file under `features/{player,checkpoint,quick,campaign}` calls the API. The server pieces that do exist have holes that would make the path farmable the moment it is wired:

- The progress rate check is the one control described as "needing no client cooperation", and it can be bypassed. The probe covered a full 1,800 s video in 3 s of wall-clock time.
- Identity comes from a spoofable header.
- Checkpoint tokens are not tied to playback position.
- The web sends the answer key to the browser.
- The Reward Engine pays a fixed 2,400 points whatever the partner configured.

Pacing, ranking, risk/fraud, moderation, the segment-log cross-check and notifications are either libraries nobody calls or missing entirely.

## 2. Attack matrix: can a user earn without watching?

"Today" means nobody can earn at all (completion is refused). The question that matters is what happens once `questionsAnswered` and the grant are wired.

| Vector                         | Server today                                                                                                                                                             | Evidence                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scrub/seek to end              | **Blocked.** Coverage, not position                                                                                                                                      | `watch-coverage.ts:133-138`, `watch.controller.ts:176-192`                                                                                        |
| Synthetic `ended` event        | **Blocked**                                                                                                                                                              | `watch-session.ts:271-290` has no terminal event                                                                                                  |
| **Scripted progress burst**    | **OPEN.** A 3 s span per report is accepted even with ~0 ms since the last report; 600 requests cover 1,800 s                                                            | `watch-progress-report.ts:126-134`, `watch.controller.ts:143-160`; probe run: `accepted=600 wallSeconds=3 fully=true`                             |
| **Parallel progress reports**  | **OPEN.** Every report is judged against the same stale `last_progress_at`; there is no lock or compare-and-set                                                          | `watch.controller.ts:138-160`, `drizzle-watch-session.repository.ts:106-119`; probe: 30 parallel 60 s spans, 60 s after start, give full coverage |
| Idle / background tab          | **OPEN.** Sleep N seconds, then claim any span of N+3 seconds; nothing checks that playback happened                                                                     | Same code; probe `idle-then-claim` accepted                                                                                                       |
| Playback-rate (e.g. 16×)       | Server refuses more than 1× per report, but the burst attack above removes that limit. The client has no rate lock                                                       | `watch-progress-report.ts:42`; `use-video-event-wiring.ts:90-120` credits every tick at any `playbackRate`                                        |
| Checkpoint token replay        | Blocked in the service (nonce PK + one answer per checkpoint), but **there is no redeem or answer endpoint**                                                             | `checkpoint.service.ts:208-234`; `redeem` has no caller outside tests                                                                             |
| Pre-fetch all checkpoint times | **OPEN.** Loop `POST .../checkpoints/{0..N}/token` until you get a 404; each call returns `atSecond`                                                                     | `checkpoint.controller.ts:92-110`; probe schedule `[245,776,1281,1584]`                                                                           |
| Answer from a leaked key       | **Worse than leaked: shipped.** The full `Question` objects, including `correctOptionId`/`correctAnswer`, go to a `"use client"` component and are scored in the browser | `app/(app)/watch/[campaignId]/checkpoint/page.tsx:23-27`, `checkpoint-quiz.tsx:1,20`, `checkpoint-scoring.ts:61-71`                               |
| Answers scored server-side     | **Missing.** `campaign.question_response` has no writer; no endpoint serves `PresentedQuestion`                                                                          | the only references to `question_response` are migrations, db tests and the sweep                                                                 |
| Parallel sessions (one user)   | Blocked by a partial unique index                                                                                                                                        | `20260920000013_watch_session.sql:48`                                                                                                             |
| **Multiple accounts**          | **Unlimited.** The principal is whatever `x-yt-user-id` says; login bearer tokens are ignored; suspension is self-declared through `x-yt-suspended`                      | `principal.service.ts:64-96` (70, 82)                                                                                                             |
| Double completion              | Latent. `markCompleted` returns `void`, so two concurrent `complete` calls both return `{completed:true}`                                                                | `drizzle-watch-session.repository.ts:129-134`, `watch.controller.ts:194-195`                                                                      |

## 3. Component by component

### 3.1 Watch sessions: `apps/api/src/modules/watch`: **exists, partial, with a broken core control**

- What works: server-side sessions, one active session per user, append-only coverage (`GRANT SELECT, INSERT` only, `20260920000013_watch_session.sql:91-92`), the composite FK to the terms version, inward rounding, and "no gaps" completion.
- The rate check compares each report's span length with elapsed time since the previous accepted report, plus a 3 s tolerance per report (`watch-progress-report.ts:126-129`). The header says _"An attacker gains at most TOLERANCE_SECONDS per report, and reports are rate-limited by the same clock"_ (`:26-27`). The first half is true, and the second half is false.
  - The span start is never tied to the previous end or to a playhead.
  - The tolerance applies to every report, with no cumulative cap.
  - Nothing rate-limits the endpoint: `@RateLimit` appears only on auth routes (`auth.controller.ts:56,74,118,142`).
  - The session row is read without a lock (`watch.controller.ts:138`, `repository.ts:106-119`).
- The fix needs to be cumulative: total accepted seconds must satisfy `≤ (now − startedAt) × 1 + a single tolerance`. The session also needs to be serialised (`SELECT … FOR UPDATE` or a compare-and-set on `last_progress_at`).
- **The duration the server demands does not match the asset that is played.** Every mock campaign points at the single 30 s fixture (`campaign.mock.ts:48-51`, `hls-origin.ts:55-73`). Campaign durations are 300–1,800 s (`campaign.mock.ts:89-92`), and the server demands coverage of `campaign.durationSeconds` (`watch.controller.ts:219-223`). The web hides the gap with a linear time-remap (`apps/web/features/player/time-remap.ts`). Once wired, an honest viewer could never complete: 30 s of video can never produce 1,800 s of coverage at 1×.
- Completion reads the campaign's current `durationSeconds`, not the duration in the terms version the session entered under (`watch.controller.ts:219-223`, compared with `session.termsVersion`).
- The `void` state exists (`watch-session.ts:213-214`) but nothing ever writes it, so there is no fraud voiding.

### 3.2 Checkpoint tokens: `watch/checkpoint`: **crypto correct; binding and endpoints missing**

- What works: HMAC with domain separation and constant-time compare (`watch-checkpoint-token.ts:274-348`); a per-session PRF schedule (`:416-442`); an atomic burn through `ON CONFLICT DO NOTHING` on two unique constraints (`checkpoint-nonce.repository.ts:60-91`); logging of refusals (`checkpoint.service.ts:258-267`).
- **Issuance is not bound to playback.** A token can be minted for any index at any time. Its expiry is 90 s from issuance, not from `atSecond`, and nothing checks that server coverage has reached `atSecond` (`checkpoint.controller.ts:57-111`). The comment at `:105-108` says the whole schedule is withheld, but enumerating indices returns all of it.
- **Tokens are not single-issue.** `@Idempotent` uses a key the client chooses (`idempotency.interceptor.ts:58`), so a fresh key mints a fresh token for the same checkpoint. That contradicts `checkpoint.controller.ts:35-44`.
- **There is no redeem or answer endpoint.** `CheckpointService.redeem` is called only from its test.
- **Pruning destroys the one-answer rule.** `prune()` deletes every expired row (`checkpoint-nonce.repository.ts:93-103`), and those rows also carry `UNIQUE(session_id, checkpoint_index)` (`20260921120000_watch_checkpoint_nonce.sql:144`). After a prune, the same checkpoint can be answered again. The migration's claim that deleting past expiry "cannot weaken the guarantee" (`:155-160`) holds for replay of a nonce, not for the second constraint. Pruning is not scheduled yet, so this is latent.
- Issuance works on paused campaigns, because it uses `findVisibleById` and never `isLive` (`checkpoint.controller.ts:82-85`).
- The web player never requests checkpoints during playback. Questions exist only as a separate route after the video (`completion-handoff.tsx:25-35`). docs/06 §5 requires checkpoints during playback at random server-chosen times.

### 3.3 Question engine: **libraries correct, not wired; the client leaks the key**

- `selectQuestionsForSession` (`question-selection.ts:103-114`) is correct: it returns only `PresentedQuestion`, uses rejection sampling and never shuffles Likert scales. **Nothing in apps calls it.**
- The DB guardrails are real: the answer key lives in a separate table (`20260920000017_question_bank.sql:72-85`); the PII gate had a null hole that has been fixed (`20260920014200...:223-229`); `yourtal_app` has INSERT-only on responses (`20260921233000...:199`).
- **The web checkpoint route is fixture-only.** It builds questions with keys (`checkpoint-data.ts:222-238`), serialises them into a client component, and scores them in the browser with a hard-coded 60/40 split (`checkpoint-scoring.ts:50,103-148`). The file admits it is advisory (`:8-40`).
- **Leak detection is not live.** `question-leak-sweep.ts` is not scheduled from anywhere, and its input table has no writer.
- Three different definitions of "how many questions" disagree:
  - the checkpoint count uses `campaign.questionCount` (`checkpoint.controller.ts:92-96`);
  - the bank rule uses `questionsAskedFor(duration)`, max 5 (`question-bank.ts:29-35`);
  - the seed uses the max of both (`seed.ts:244`);
  - the terms CHECK allows up to 20 (`20260920000012...:123`).

### 3.4 Reward Engine (`services/ledger/internal/reward`): **exists and works for allocation safety; wrong model; unreachable**

- What works:
  - A drawdown of `UPDATE … WHERE remaining_points >= $n` inside a serializable transaction with the ledger post and grant log (`engine.go:207-284`, `ledger.sql:57-65`), with a concurrent over-draw test (`engine_test.go:146`).
  - Idempotency per (user, action, external_ref) (`20260919000007_reward_engine.sql:60`). A replay rolls the drawdown back and returns `ErrAlreadyGranted` (`engine.go:268-270`).
- **The reward size is hard-coded**:
  - `ActionWatchCompleted` = 2,400 points, 20 per day (`taxonomy.go:88-90`);
  - `checkpoint_correct` = 200 flat (`:94-96`).
  - This contradicts the fixed founder decision (partner-funded, variable, no hard-coded size) and `campaign.reward_config`.
  - Migration `20260922020000_ledger_reads_campaign_reward_config.sql:14-17,41-42` granted the read so the engine _could_ consult reward_config, but **no Go code reads `campaign.reward_config`**.
  - The result: 1-minute and 30-minute campaigns pay the same.
  - `max_points_for_campaign` is never enforced.
- **Evidence is checked for presence only.** Any non-empty string passes (`engine.go:131-134`).
- The risk gate is `AlwaysAllow` (`engine.go:60-62`).
- **Velocity caps are check-then-act.** `checkVelocity` counts on the pool, outside the issuing transaction (`engine.go:144,157-202`), so parallel grants with distinct refs exceed the user, device and IP caps. The only test is sequential (`engine_test.go:190-227`).
- Grant and transfer IDs leave out the user ID (`engine.go:239,255`). Two users sharing an `ExternalRef` (for example if a caller passes the campaign ID) collide on the primary key and the second user gets a generic error.
- `quick_watched` requires a checkpoint token (`taxonomy.go:91-93`), but a campaign of 60 s or less gets 30 s or less of usable schedule and usually no checkpoints (`watch-checkpoint-token.ts:417-420`).

### 3.5 Pacing and budget: **stub, a pure library with no state and no caller**

- `campaign-pacing.ts` is correct arithmetic, and it honestly says concurrent overspend is **not** bounded within a cycle (`:51-58`). That contradicts docs/18 §13.
- Nothing calls `canServe` or `applySpend`, there is no `PacingState` storage, and the campaigns table has no budget column (`campaign.table.ts:12-28`).
- The only real stop is the ledger allocation drawdown, which is per allocation, not per campaign, and unreachable.
- No seeded campaign has a `reward_config` row (`seed.ts` never writes one), so no campaign is linked to an allocation.

### 3.6 Campaign selection and ranking: **missing (server); static client sort**

- The API lists visible campaigns ordered by `published_at` (`drizzle-campaign.repository.ts:155-169`).
- There is no filter for targeting, frequency cap, pacing or already-completed (docs/18 §7 P1).
- The web sorts a mock list by points per minute (`campaign-sort.ts:33-50`), with hard-coded Indonesian labels (`:16-21`).

### 3.7 Lifecycle: **contract-only**

- `CAMPAIGN_LIFECYCLE_TRANSITIONS` (`campaign-lifecycle.ts:65-94`) is used only by tests. There is no API use case to submit, review, publish or pause.
- The DB has a CHECK on the value but no transition trigger, and `yourtal_app` can set `draft→live` directly.
- The notification engine is missing: no jobs, and `@yourtal/queue` and `@yourtal/drivers` are imported by no app.

### 3.8 Media and the segment-log cross-check: **stub**

- `signed-segment-url.ts` is correct but is **not exported** (`packages/media/package.json:5-8`) and has no consumer.
- The MinIO origin is anonymous (`hls-origin.ts:107-110`). No proxy verifies tokens, no playlist rewriting mints them, no delivery-log writer exists, and no cross-check exists (YT-0123 is `todo`).

### 3.9 Risk and fraud, and moderation: **missing**

- Risk: only `AlwaysAllow`, plus `device-signals.ts`, which nothing consumes. There is no suspension storage: `principal_security_state` has only `value_frozen_until` (`20260921130000...:33-41`). "Suspend and escrow" does not exist.
- Moderation: a simulated text classifier (`packages/drivers/src/boundaries/moderation.ts`) with no caller. There is no ingest, ASR, OCR or human queue.

### 3.10 Cross-cutting blockers found on this path

1. **Identity is spoofable** (`principal.service.ts:64-96`), and the service refuses to boot in production at all (`:54-61`). That blocks Helios as a production target.
2. **PDP resource attributes are missing.**
   - Every watch and campaign route declares `campaign_view` without `attrsFrom`: `watch.controller.ts:66,101,121,169`, `checkpoint.controller.ts:55`, `campaign.controller.ts:31,46`.
   - The guard therefore sends `attr: {}` (`pdp.guard.ts:66-78`).
   - The schema requires `campaignId` (`policies/_schemas/resource/campaign_view.json` `required`), the allow rule requires `state == "live"` (`campaign_view.yaml:36-45`), and Cerbos runs with `enforcement: reject` (`infra/cerbos/config.yaml:30`).
   - So under the real PDP every one of these routes should deny. All controller tests build the controller directly and bypass the guard (`watch.controller.test.ts:50`). Not executed against a live Cerbos, but the config is unambiguous.
3. **Indonesian defaults on this path:**
   - `accrual-indicator.tsx:41`, `completion-handoff.tsx:23`, `quick-feed-label.ts:27` and `campaign-format.ts:10-36` default to `id-ID`;
   - `video-player.tsx:76-81` passes no locale;
   - the principal jurisdiction defaults to `"ID"` (`principal.service.ts:72`).
4. **The accrual indicator is a display lie under O-1.** Chapters are credited from `virtualCurrentTime`, which a seek sets (`use-watch-session.ts:282-288`), so scrubbing fills the bar to the full reward (`video-player.tsx:76-81,108`).

## 4. Board versus reality

`docs/tasks/phase-1-campaign.md` marks YT-0121, YT-0122 and YT-0125 `done`.

- **YT-0121:** "rejected and logged" is true in the service, but no endpoint redeems a token.
- **YT-0122:** "Per-user random subset … per-question timer", "latency and input entropy recorded", "answers stored against the campaign". The first is a library with no caller. The timer is client-only. Nothing records latency or entropy, and nothing writes an answer.
- **YT-0125:** a sweep that is not scheduled, over a table with no rows.
- **YT-0120 `done`:** fair for the model, but its criterion "a scripted client … is stopped by the clock" (`watch-progress-report.ts:15-18`) is false (§2).

## 5. Engines missing entirely

1. Risk and fraud engine: placeholder gate only, no signals consumed, no suspension or escrow.
2. Moderation engine: pipeline, queue and reviewer UI.
3. Campaign selection and ranking (server side).
4. Pacing engine at runtime: state, serving check and settlement writer.
5. The CDN or segment-log cross-check (and the signing origin).
6. Question delivery and server-side scoring, including the answer endpoint.
7. The link from watch completion to a Reward Engine grant: an authenticated ledger route, evidence verification, and use of reward_config.
8. The lifecycle transition service and the notification engine.

## 6. Recommendations (order of work)

1. Replace `PrincipalService.resolve` with a bearer-session lookup (the auth module already mints tokens, `auth.controller.ts:79-81`). Read suspension from the DB and default jurisdiction from the registration region (AU first).
2. Fix the progress rate check: a cumulative budget from `startedAt`, one tolerance per session, a per-session row lock, contiguity with the last accepted end (so a seek re-anchors without crediting), and a `@RateLimit` on progress.
3. Make campaign duration the asset's real duration. Either seed a campaign per fixture length or generate fixtures to match, and delete `time-remap.ts`.
4. Build the checkpoint flow end to end:
   - issue a token only when server coverage has reached `atSecond − ε`, at most one issuance per (session, index), revealing only the next time;
   - add `POST …/checkpoints/{i}/answer`, which redeems the token, scores on the server from `question_answer_key`, writes `question_response` with server-measured latency, and updates the counters;
   - move the answered-once constraint into a table that is never pruned.
5. Wire `complete`:
   - require every checkpoint answered;
   - `markCompleted` must return whether a row matched, and grant only if it did;
   - call the ledger with `ExternalRef = sessionId`, evidence as a service-signed completion attestation, and the amount read from `campaign.reward_config` or the terms version (remove the fixed taxonomy magnitudes);
   - enforce `max_points_for_campaign` in the same transaction;
   - move the velocity counts inside the serializable transaction.
6. Pass `campaign_view` attributes (campaignId, state, openViewing*) through `attrsFrom` via an async resource loader, and add a guard-to-Cerbos integration test for one watch route.
7. Pacing: store `PacingState` per campaign, check `canServe` at session start, and apply `applySpend` in the grant settlement.
8. Selection v1: filter live, funded, pacing-allowed and not-yet-completed campaigns; sort by expected value; do it on the server.
9. Client: pin `playbackRate` to 1 in reward-bearing sessions, pause on `visibilitychange`, drive progress UI from server coverage, and default locale to en-AU.
10. Defer the segment-log cross-check, ML risk and the LLM moderation pipeline until the above is working. Record the deferral honestly rather than marking tickets done.
