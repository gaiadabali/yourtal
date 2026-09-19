# Phase 2 & 3 · Epics

Deliberately coarse. Breaking these into tasks now would be guesswork — the shape depends on what Phase 1 learns. Each becomes a task file when its phase opens.

---

## Phase 2 · Depth and intelligence

### YT-0300 · Surveys routed to an external panel
`todo` · P2 · store · 15d · dep: YT-0122

- [ ] In-feed one-question delivery reusing the checkpoint mechanism
- [ ] Routed to Cint / Prodege / Toluna rather than building panel supply
- [ ] Separate research disclosure and consent, distinct from campaign questions

### YT-0301 · Offerwall integration
`todo` · P2 · store · 10d · dep: YT-0045

- [ ] An existing offerwall provider integrated for CPA offers
- [ ] Server-side verification before any credit

### YT-0302 · Skill-based mini-games
`todo` · P2 · web · 15d · dep: YT-0045

- [ ] Three to four games, shared reward plumbing, no chance mechanic anywhere
- [ ] Reviewed against Indonesian prize-draw rules before release

### YT-0303 · Digital and physical merchandise
`todo` · P2 · commerce · 20d · dep: YT-0135

- [ ] Merchant KYB with NIB verification and expiry tracking (Permendag 19/2026)
- [ ] Catalogue, inventory with TTL reservations, order state machine, returns
- [ ] Merchant-fulfilled only; courier aggregator, never direct courier integrations

### YT-0304 · Voucher transfer
`todo` · P2 · value · 12d · dep: YT-0142

- [ ] Void-and-remint; one hop only; verified recipient only
- [ ] Holdback before transfer, velocity caps, per-batch opt-in
- [ ] Transfer design re-checked against position ID-1 in `docs/24-legal-positions.md`; if it moves us toward transferable stored value, this is a counsel trigger, not a judgement call

### YT-0305 · Shopify app and WooCommerce plugin
`todo` · P2 · merchant · 20d · dep: YT-0151

- [ ] Codes synced so they work at native checkout
- [ ] Published in both marketplaces with install-time credential exchange

### YT-0306 · Self-serve advertiser console
`todo` · P2 · adplatform · 20d · dep: YT-0114

- [ ] Campaign creation, upload, question authoring and prepaid billing without a human
- [ ] LLM-assisted campaign setup; automated moderation with a human queue behind it

### YT-0307 · Dynamic demand multiplier and economy dashboard
`todo` · P2 · economy · 12d · dep: YT-0049

- [ ] Bounded multiplier driven by demand and scarcity
- [ ] Faucet/sink, coverage, velocity and catalogue-depth dashboard reviewed daily

### YT-0308 · Clearing automation
`todo` · P2 · value · 10d · dep: YT-0161

- [ ] Statements, dispute handling and payout run without manual steps
- [ ] Partner self-service statement portal

### YT-0309 · Recall and brand-lift reporting as a paid tier
`todo` · P2 · adplatform · 10d · dep: YT-0108

- [ ] Packaged, priced and sold separately from media
- [ ] Methodology published so advertisers can audit it

### YT-0360 · p(completion) model
`todo` · P2 · data · 12d · dep: YT-0059, YT-0216

- [ ] Predicts whether _this_ user finishes _this_ campaign, from watch history, campaign length, chapter drop-off curves and interest match
- [ ] Offline eval against a held-out month before it touches serving; beats the counting baseline on AUC and on calibration, or it does not ship
- [ ] Calibration checked explicitly — a predicted 0.7 must complete ~70% of the time, because delivery cost is spent on the prediction
- [ ] Shadow-mode for two weeks with decisions logged but not applied
- [ ] Rules fallback on timeout, error or drift; failure is never a blocked serve

### YT-0361 · Fraud scoring model
`todo` · P2 · risk · 12d · dep: YT-0186

- [ ] Gradient-boosted classifier over velocity, graph, device, answer-latency and redemption-pattern features
- [ ] Trained on confirmed-fraud labels from manual review, not on heuristic output — otherwise it only learns the existing rules
- [ ] Precision/recall targets set against the cost of a false positive (a suspended honest user) versus a false negative
- [ ] Every score is explainable to a human reviewer with the top contributing features
- [ ] Rules engine retained in parallel; the model raises or lowers a score, it never decides alone

### YT-0362 · Model serving, eval harness and drift monitoring
`todo` · P2 · data · 8d · dep: YT-0360

- [ ] FastAPI scoring service; feature store on Redis online, ClickHouse offline
- [ ] Versioned models with recorded training data, hyperparameters and eval results — reproducible or it does not deploy
- [ ] Feature drift and prediction drift monitored with alert thresholds
- [ ] Automatic rollback to the previous version on a guardrail breach

### YT-0363 · LLM pipeline engineering for moderation
`todo` · P2 · media · 8d · dep: YT-0113

- [ ] Prompts versioned in the repo and treated as code, with a golden-set eval running in CI
- [ ] Labelled regression set of creatives and question banks including known-bad cases; precision and recall tracked per release
- [ ] Structured output validated against a Zod schema; a malformed response escalates to human review rather than failing open
- [ ] Per-creative cost ceiling, timeout and retry policy; cost per moderated minute reported to finance
- [ ] The model never auto-approves — verified by test, not by convention

### YT-0311 · Measurement credibility
`todo` · P2 · adplatform · 12d · dep: YT-0108

- [ ] MRC GIVT filtration; viewability methodology published
- [ ] An advertiser can be shown an auditable delivery report

### YT-0312 · Video cost migration to R2 + own transcode
`todo` · P2 · media · 15d · dep: YT-0116

- [ ] Triggered at ~5M delivered minutes/month
- [ ] Own ffmpeg transcode and HLS packaging behind the existing media interface
- [ ] Cost per delivered minute measured before and after

## Phase 3 · Marketplace, charity, Australia

### YT-0320 · Voucher bidding marketplace
`todo` · P3 · store · 25d · dep: YT-0304

- [ ] Per-auction serialisation; anti-sniping extension; escrow
- [ ] Void-and-remint on transfer; effectively-once settlement; dispute handling

### YT-0321 · Charity via permit-holding partners
`todo` · P3 · store · 15d · dep: YT-0320

- [ ] Partner charity is the collector; proceeds settle directly to their account
- [ ] PUB permit (Indonesia) and ACNC registration (Australia) verified before listing
- [ ] Distribution reporting and clear disclosure to the user

### YT-0322 · Australia launch
`todo` · P3 · infra · 30d · dep: YT-0199

- [ ] Sydney data plane live; AU entity trading; AU merchant network signed
- [ ] Consent flows built to the Privacy Act reform's fair-and-reasonable standard
- [ ] Trade-promotion compliance per state for any chance-based mechanic

### YT-0323 · Cash wallet, in-only
`todo` · P3 · value · 15d · dep: YT-0162

- [ ] Advertiser billing and marketplace proceeds held as platform credit
- [ ] No withdrawal; the switch stays off in the jurisdiction policy service

### YT-0324 · Cross-app points across all sister apps
`todo` · P3 · platform · 15d · dep: YT-0191

- [ ] freetaxreturns, uniqueweightloss and humanspedia integrated via the earn SDK
- [ ] Shared risk signals across every app

### YT-0325 · Capacitor wrap and Play Store listing
`todo` · P3 · risk · 12d · dep: YT-0188

- [ ] Triggered only if fraud loss exceeds ~3% of reward value for two consecutive months
- [ ] Play Integrity wired through the existing device-signal interface, no rewrite


## Geographic coverage map — DEFERRED, not scheduled

**Founder decision 2026-09-19: this waits until the current plan is done, working and running.** Recorded here in full so nothing is lost and so the *cheap* parts can be got right early — the geography taxonomy is shared with local SEO pages, which ship long before any map does. **Nothing below is to be started, and no dataset is to be downloaded, without the founder saying go.**

### YT-0543 · Geography taxonomy and boundary data
`todo` · P2 · data · 5d · dep: —

- [ ] **Australia: ABS boundaries, not Australia Post postcodes.** Australia Post licenses its postcode dataset for commercial use; the ABS publishes Statistical Areas and Postal Areas free under CC BY 4.0. Using the wrong one is a licensing problem discovered after launch
- [ ] **Postcodes are delivery routes, not polygons.** `POA` is an ABS *approximation* of them, and postcode choropleths are a known cartographic trap — overlapping, non-contiguous, wildly unequal population. **SA2 is the better unit for a density map**; keep postcode only where a user types one
- [ ] **Indonesia: check the licence before the data.** GADM forbids commercial use. geoBoundaries (CC BY 4.0) and Badan Informasi Geospasial are the defensible sources
- [ ] Every boundary set records its source, licence and attribution string **in the repo**, next to the data
- [ ] District identifiers reconcile with the existing `merchantLocation.district` so the map and the store agree on where a place is

### YT-0544 · Coverage aggregation with a k-anonymity floor
`todo` · P2 · data · 5d · dep: YT-0543, YT-0217

- [ ] **The floor is in the aggregation, not in the renderer.** A region below the threshold must not exist in the API response — if it reaches the browser, it has leaked, whatever the map chooses to draw
- [ ] Same ≥1,000-per-country cohort floor as `docs/20` §7, applied per region and per campaign breakdown
- [ ] ⚠️ **"Down to its detail" is the requirement and also the risk.** A density map at low coverage is a re-identification surface: one dot in a rural SA2 is one household. This is the one feature where the honest answer to "can we zoom further" is sometimes no
- [ ] Suppressed regions render as *no data*, visibly distinct from *zero users* — conflating them makes the map lie in the direction that flatters us

### YT-0545 · The map surface
`todo` · P2 · web · 8d · dep: YT-0544

- [ ] Australia and Indonesia, animated density, the blinking-dot fill the founder described
- [ ] **Budget is the hard part, not the animation.** Boundary geometry is large; full ABS SA2 is tens of MB. Simplify server-side, tile it, and keep it off the initial bundle — the 200KB initial-JS gate applies to this route like every other
- [ ] Hand-built SVG or a canvas/WebGL renderer; the stack has no charting library and this does not justify adding one
- [ ] Respects `prefers-reduced-motion` — a pulsing national map is a genuine vestibular trigger, and the animation is decoration over data that must read without it
- [ ] Keyboard and screen-reader path to the same numbers, because a map is the classic surface where the data is only available to people who can see it

### YT-0546 · Location pages for local SEO
`todo` · P2 · seo · 5d · dep: YT-0543

- [ ] Indexable per-district merchant and offer pages, server-rendered, from the **same taxonomy the map uses** — one geography, two products
- [ ] This is the part with near-term value and it does **not** depend on the map. If the map is deferred again, this should not be
