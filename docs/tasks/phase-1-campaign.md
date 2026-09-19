# Phase 1 · Campaigns, media, watch sessions

The earning half of the loop: a business uploads a video with questions, a user watches and answers, points are credited.

---

## Ad platform

### YT-0100 · Advertiser accounts and business onboarding
`review` · P1 · adplatform · 4d · dep: YT-0035

- [x] Business entity, members with roles, billing contact — reuses `@yourtal/contracts/business` and `@yourtal/authz/roles` verbatim, so the data model feeds `P.attr.businessRoles` with no translation layer
- [ ] KYB capture — **PARTIAL.** Metadata, type, status and expiry tracked; `storageRef` points at the bytes. **Nothing encrypts a document.** KMS envelope encryption and the signed-upload path are unbuilt and were not in this ticket's dependencies
- [ ] Tenant isolation — **not independently verifiable yet**, because campaign and report modules do not exist (YT-0101+). Attestable now: every business-scoped query is keyed by `businessId`, and tenancy resolves through the PDP rather than a client-supplied scope
- Verified 2026-09-19: 92 tests, 81 source files, largest 97 lines. **`apps/api` has never booted** — no Cerbos sidecar, no database; everything Drizzle/Postgres is typechecked only, and the in-memory repositories are what the tests exercise. No migration generated
- Authz seam as specified: `PrincipalService.resolve()` is the single assembly point and `pdp.requireAction(...)` is called identically at every route, so **YT-0500 changes only the body of `resolve()`** and no call site moves

### YT-0101 · Campaign model and lifecycle
`todo` · P1 · adplatform · 5d · dep: YT-0100, YT-0031

- [ ] Campaign → creative → reward config → question bank, with draft/review/live/paused/ended states
- [ ] Reward config draws from a funded point allocation and hard-stops at zero
- [ ] Terms shown to a user at entry are frozen for the duration of their watch

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
`todo` · P1 · watch · 5d · dep: YT-0101, YT-0039

- [ ] Server-side watch position, resumable across devices and sessions
- [ ] One reward-bearing session per user at a time
- [ ] Campaign-level expiry, not session-level

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
`todo` · P1 · watch · 4d · dep: YT-0123, YT-0045

- [ ] Reward accrues per checkpoint, back-loaded toward completion
- [ ] Abandoning mid-way keeps what was earned
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
