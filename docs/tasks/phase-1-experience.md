# Phase 1 · User experience, risk, sister apps, launch readiness

---

## Web

### YT-0170 · Feed
`todo` · P1 · web · 5d · dep: YT-0107, YT-0055

- [ ] Server-rendered campaign cards showing duration, reward and estimated MB
- [ ] Infinite scroll without layout shift; skeletons with correct dimensions
- [ ] Meets the CWV budget on a mid-tier Android over 4G

### YT-0171 · Long-form player
`todo` · P1 · web · 5d · dep: YT-0120, YT-0115

- [ ] `hls.js` loaded on tap, never in the shell; first frame under 1.0 s
- [ ] Starts at 360–480p on cellular, capped at 720p, manual opt-up only
- [ ] Screen Wake Lock held; playback rate locked for reward-bearing sessions

### YT-0172 · Watch: chapters, progress, resume
`todo` · P1 · web · 4d · dep: YT-0171

- [ ] Chapter progress and accrued reward visible throughout
- [ ] Resume from the server-side position on any device
- [ ] Reward accrual visibly pauses when the tab is backgrounded

### YT-0173 · Checkpoint question UI
`todo` · P1 · web · 4d · dep: YT-0172, YT-0122

- [ ] One question at a time, conversational, with a visible timer
- [ ] Clear framing that questions are the price of the reward, shown before the watch starts
- [ ] Fully keyboard and screen-reader accessible

### YT-0174 · Points balance and history
`todo` · P1 · web · 3d · dep: YT-0042, YT-0055

- [ ] Balance, pending (in holdback), and a plain-language transaction history
- [ ] Expiry dates shown before they matter, not after

### YT-0175 · Store and checkout UI
`todo` · P1 · web · 5d · dep: YT-0133, YT-0132

- [ ] Price, terms, transferability and partial-redemption policy shown before committing points
- [ ] Price-lock countdown visible in cart
- [ ] Confirmation states exactly what was received and how to use it

### YT-0176 · Voucher wallet, offline
`todo` · P1 · web · 4d · dep: YT-0143, YT-0175

- [ ] Active vouchers and their rotating QR render from the service worker with no network
- [ ] Redemption instructions per merchant, in the user's language
- [ ] Used and expired vouchers archived, never silently deleted

### YT-0177 · Streaks and daily check-in
`review` · P1 · web · 3d · dep: YT-0045

- [ ] ⚠️ **The mechanic is built exactly as specified — a missed day resets the streak to 1, no grace — and that needs a product decision rather than an engineering default.** Built as asked rather than softened unasked, which was right, but a streak that punishes a missed day works against a rewards product: it converts a good week into a loss the first time someone is busy
- [ ] ⛔ **"Funded from the reserve like any other faucet" is not built and cannot be built from the frontend.** No streak contract and no faucet endpoint exist. The card is honest about it — it tracks locally and shows the *schedule*, and never claims a point has landed in the wallet. Real issuance is backend work and needs both a contract and a faucet, which rule K6 says must be cash-backed at the moment of issue
- [ ] Deterministic escalating rewards; no chance element anywhere
- [ ] Funded from the reserve like any other faucet

### YT-0178 · Onboarding and PWA install
`todo` · P1 · web · 4d · dep: YT-0033, YT-0055

- [ ] Phone OTP signup under 60 seconds on a slow connection
- [ ] Install prompt at the first successful reward, with a points bonus
- [ ] Consent screens are specific, unambiguous and per-purpose

### YT-0179 · Web push and re-engagement
`todo` · P1 · web · 3d · dep: YT-0178

- [ ] Web push on Android Chrome; iOS path documented as install-then-enable
- [ ] WhatsApp fallback for Indonesia, opt-in only
- [ ] Every notification has an off switch that works first time

## SEO

### YT-0180 · Public catalogue and merchant pages
`review` · P1 · seo · 2d · dep: YT-0132

- [x] **Both gaps closed and verified in built HTML, not asserted.** `LocalBusiness` is emitted **one node per distinct outlet**, each `branchOf` the existing `Organization` — a three-branch merchant gets three nodes, never one. It returns nothing for a merchant known only from a campaign, because inventing an address is worse than omitting the markup
- [x] `sitemap.ts` and `robots.ts` exist. The sitemap is generated from the same locale-scoped catalogue calls the routes already use, so it cannot drift from what is actually published; `lastModified` comes only from campaigns’ real `publishedAt` and is omitted where no comparable field exists rather than fabricated
- [x] **`robots.ts` is an allowlist** (`Allow: /id`, `Allow: /au`, `Disallow: /`) rather than a denylist of private routes — so a future private route stays unindexed with no robots change. A denylist fails open, which is the wrong direction to fail for a page nobody meant to publish
- **Audited 2026-09-20: Phase U built most of this and the `seo` epic was reading 0/5 because of it.** Estimate cut 5d → 2d; only the two gaps below remain. Third time a Phase U deliverable was left unrecorded in another phase
- [x] Offer and merchant pages server-rendered, indexable, with canonical URLs — `/[locale]/m/[merchant]` and `/[locale]/rewards/[merchant]/[offerId]` ship with `alternates.canonical`
- [x] JSON-LD for Offer and BreadcrumbList — both emitted by `public-jsonld.ts`, alongside Product, Organization and ItemList
- [ ] ⚠️ **LocalBusiness is missing.** The page emits `Organization` and `Brand`, which do not carry address or geo — and `LocalBusiness` is the type that earns a place in local search results, which is the whole point of a merchant page. It also needs the `locations[]` work from YT-0502 to say anything true about branches
- [ ] ⚠️ **There is no sitemap and no robots.txt at all.** No `sitemap.ts`, no `robots.ts` anywhere in `apps/web/app`. Every public page is currently discoverable only by a link someone already followed

### YT-0181 · Internationalised routing and hreflang
`review` · P1 · seo · 3d · dep: YT-0058, YT-0180

- [x] ✅ **`/au` serves.** `GENERATED_PUBLIC_LOCALES` is now `["id", "au"]` and `next build` emits `● /au` with genuinely Australian data (Cedar Deli Bar, Sydney CBD Cafe — not Jakarta content under an Australian URL). This was the widest gap between plan and build: **Australia is the primary market and its entire public surface returned 404**
- [x] Locale-scoped data readers never search both catalogues, so an `/au/...` URL for an ID-only entity 404s rather than leaking Jakarta content
- [x] ⚠️ **hreflang is deliberately limited to the home and catalogue-hub pages**, and this refusal is the interesting part: AU and ID read disjoint, independently seeded catalogues, so a specific Jakarta campaign has **no Australian counterpart**. Declaring one would tell a crawler that two unrelated pages are the same content. When the catalogues genuinely mirror, this expands
- [ ] Subdirectory locale routing with correct hreflang pairs for id-ID and en-AU
- [ ] Country content genuinely separated — no cross-region offers leak into a sitemap

## Risk

### YT-0185 · Fraud rules v1
`todo` · P1 · risk · 5d · dep: YT-0054, YT-0124

- [ ] Timing plausibility, velocity, device reuse and impossible-flow rules
- [ ] Rules are configurable without a deploy and every change is audit-logged
- [ ] Suspected accounts are suspended, not silently zeroed

### YT-0186 · Graph clustering on shared signals
`todo` · P1 · risk · 5d · dep: YT-0185

- [ ] Cluster on device, IP/ASN, phone prefix, payout destination and answer pattern
- [ ] Analyst can review a cluster and action it in one step

### YT-0187 · Referral programme, safely
`todo` · P1 · risk · 3d · dep: YT-0185

- [ ] Referral pays on the referee's day-7 retention and verified activity, never on signup
- [ ] Per-referrer caps; self-referral detection

### YT-0188 · Fraud loss reporting
`todo` · P1 · risk · 3d · dep: YT-0186

- [ ] Loss as a percentage of reward value issued, weekly, visible to leadership
- [ ] Threshold that triggers the Capacitor-wrap decision is written down

## Sister apps

### YT-0190 · `@yourtal/earn` server SDK
`todo` · P1 · platform · 4d · dep: YT-0045, YT-0031

- [ ] `POST /actions` with idempotency key and evidence; sister apps never credit directly
- [ ] Typed client generated from the contracts package
- [ ] Reference integration documented end to end

### YT-0191 · snap-apps receipt-scan earning
`todo` · P1 · platform · 4d · dep: YT-0190

- [ ] Action type registered with value band, caps and evidence requirements
- [ ] Points funded by a real cash transfer into the reserve at issuance
- [ ] A device banned in snap-apps is banned for YourTal rewards

## Launch

### YT-0195 · Finance reporting pack
`todo` · P1 · value · 4d · dep: YT-0047, YT-0161

- [ ] Points liability, breakage, coverage ratio and segregated float, monthly
- [ ] Reviewed with an external accountant before launch

### YT-0196 · Support, disputes and appeals
`todo` · P1 · merchant · 4d · dep: YT-0154, YT-0185

- [ ] A user can dispute a failed reward, a failed redemption or a suspension, and get an answer
- [ ] Instant points refund when a merchant fails to honour a valid voucher, recovered at settlement

### YT-0197 · Security review and penetration test
`todo` · P1 · risk · 5d · dep: YT-0151, YT-0140

- [ ] External pen test scoped to the value layer and the merchant redemption API
- [ ] All critical and high findings closed before launch

### YT-0198 · Load and failure testing
`todo` · P1 · infra · 4d · dep: YT-0107, YT-0133

- [ ] 10× projected launch load sustained; ledger and redemption correct throughout
- [ ] Region failure, Stream outage and supplier outage rehearsed

### YT-0199 · Launch runbook and incident response
`todo` · P1 · infra · 3d · dep: YT-0197, YT-0198

- [ ] On-call rota, escalation, kill switches documented and tested
- [ ] Breach-notification timelines for Indonesia and Australia written into the runbook

## Surfaces & roles

### YT-0200 · Business team management and roles
`todo` · P1 · adplatform · 4d · dep: YT-0100, YT-0035

- [ ] Six roles (Owner, Admin, Marketer, Merchandiser, Finance, Analyst) enforced through Cerbos, not in app code
- [ ] Exactly one Owner; transfer requires re-authentication
- [ ] Two-person approval on bulk issuance, downward settlement-value changes and credential rotation
- [ ] Every team action audit-logged and visible to the business itself

### YT-0201 · Store device sessions for counter staff
`todo` · P1 · merchant · 4d · dep: YT-0154, YT-0200

- [ ] Admin provisions a named device bound to a location; long-lived credential on that device only
- [ ] Short PIN unlocks the session; it does not authenticate a person
- [ ] Capabilities limited to redeem, look up, view today — never mint or adjust
- [ ] Instantly revocable per device from the Team zone

### YT-0202 · Business dashboard information architecture
`todo` · P1 · adplatform · 5d · dep: YT-0200

- [ ] Three zones shown only when the business holds that relationship: Campaigns, Inventory, Redemption
- [ ] Plus Reports, Billing and Team
- [ ] Desktop-first, usable on tablet

### YT-0203 · User information architecture: five surfaces
`review` · P1 · web · 4d · dep: YT-0055

- [x] **Audited 2026-09-20: already built and compliant, tracker was stale.** Five tabs in `features/shell/nav-items.ts`, cards carry duration · reward · estimated MB · merchant, and the shell widens rather than forking. No gaps found against the criteria
- [ ] Earn, Quick, Store, Wallet, Me as the mobile tab structure
- [ ] Every campaign card states duration, reward and estimated MB before entry
- [ ] Tablet and desktop widen the same product; they do not fork it

### YT-0204 · Quick feed (short-form habit loop)
`todo` · P1 · web · 5d · dep: YT-0203, YT-0171

- [ ] Vertical swipeable feed of 15–60 s campaigns, points-only rewards
- [ ] Prefetch the next item only on unmetered connections
- [ ] Never autoplays into an item the user did not choose to reach

### YT-0205 · Logged-out surfaces
`todo` · P1 · seo · 4d · dep: YT-0180

- ✅ **RESOLVED by decision O-1 (2026-09-20).** The 90-second preview criterion is **superseded**: anonymous visitors watch the **full** campaign and accrue nothing, which is exactly what YT-0432 shipped. The founder’s model makes this coherent — the gate on reward is *completion plus questions*, and an anonymous viewer is outside the reward path entirely, so there is no reason to truncate them. The business still gets the view, which is the stated benefit of Open Viewing
- ⛔ **BLOCKED on a product decision, not on engineering (2026-09-20).** This task asks for a **≤90-second preview** that plays without an account. **YT-0432 already shipped the opposite, deliberately**: anonymous **full-length** playback with no cap, with a sign-up prompt at completion, and its doc comments argue the case at length
- Both are defensible and they are mutually exclusive. A teaser converts on curiosity; full playback converts on reciprocity and is what makes a shared campaign link work for the recipient — which `docs/19` §5 calls the precondition for every sharing mechanic
- The frontend stream **declined to add the cap**, correctly: silently regressing a shipped, deliberately designed feature to satisfy stale AC text is not a call an implementer should make
- [ ] ⚠️ **Founder decides: update this AC to match YT-0432, or revisit YT-0432.** Until then the other criteria are met and this is the only open item
- [ ] Anonymous visitors can browse the catalogue, offer, merchant and campaign pages
- [ ] A ≤90 s campaign preview plays without an account and accrues nothing
- [ ] No anonymous watch-then-claim path exists anywhere

### YT-0206 · Signup conversion from a public page
`todo` · P1 · web · 3d · dep: YT-0205, YT-0178

- [ ] Every public surface carries one call to action naming the actual reward value
- [ ] Phone OTP signup completes in under 60 seconds on a throttled connection
- [ ] The user returns to exactly the campaign or offer they came from

## Momentum

### YT-0211 · Shareable voucher-earned moment
`todo` · P1 · web · 3d · dep: YT-0176

- [ ] Share sheet after a voucher is earned, with an image card stating the value and the merchant
- [ ] Shared link opens a public campaign or merchant page that plays immediately
- [ ] Share events attributed so we can measure which moments actually spread

### YT-0212 · Open Graph and share cards on public pages
`review` · P1 · seo · 3d · dep: YT-0205, YT-0180

- [x] **The gap was not what the ticket assumed.** Phase U had already shipped real OG cards on all four public page types; what was missing everywhere was `twitter:card`. Next’s `opengraph-image.tsx` convention emits only `og:image`, so Twitter/X rendered no card at all despite the image existing
- [x] The Twitter tags reuse the exact title, description and image URL the OG metadata already computes, so **the two cannot drift by construction** rather than by discipline
- [ ] Campaign, offer and merchant pages carry OG and Twitter card metadata with a generated image
- [ ] Image states reward value, duration and merchant; generated at build or on demand and cached
- [ ] Renders correctly in WhatsApp, Instagram and Facebook previews

### YT-0213 · Seeded inventory for cold start
`todo` · P1 · economy · 4d · dep: YT-0046, YT-0130

- [ ] Platform can act as a funding partner: cash into the reserve, inventory pre-purchased at settlement value
- [ ] Seeded listings are indistinguishable to users from merchant-funded ones
- [ ] Burn reported weekly as points issued x B against reserve drawdown, by district and category

### YT-0214 · Purpose-specific consent surfaces
`todo` · P1 · platform · 4d · dep: YT-0036, YT-0178

- [ ] Each processing purpose separately toggleable, in Bahasa and English, versioned
- [ ] Receipt-data consent is separate and opt-in, never bundled into signup
- [ ] Anonymous analytics are aggregate-only; no individual anonymous profile is ever created
- [ ] The consent service answer is load-bearing in code, not advisory

## Interest & preference

### YT-0215 · Interest taxonomy
`todo` · P1 · data · 4d · dep: YT-0030

- [ ] Hierarchical tree of ~300-500 nodes, versioned in the contracts package
- [ ] Merchant, listing and receipt categories all map onto the same tree
- [ ] Sensitive nodes (health, pregnancy, religion, politics, sexuality, ethnicity, financial distress) cannot be created, scored or targeted \u2014 enforced in the mapper, not in policy
- [ ] Merchants implying a sensitive category map to a neutral parent

### YT-0216 · Interest scoring service
`todo` · P1 · data · 5d · dep: YT-0215, YT-0036

- [ ] Weighted signal sum with 90-day behavioural and 365-day declared half-lives
- [ ] An interest is not actionable below 3 signals from 2 distinct sources
- [ ] Profile computed per consent purpose; withdrawing consent drops those signals on the next recompute
- [ ] Recomputed on a schedule; serving path reads a materialised profile from Redis

### YT-0217 · Cohort floor for advertiser targeting and reporting
`todo` · P1 · adplatform · 3d · dep: YT-0216, YT-0105

- [ ] A segment below 1,000 users in-country does not exist in any advertiser interface
- [ ] Advertisers select taxonomy nodes, never raw signals or individual behaviours
- [ ] No user-level export exists in any interface at any account tier

### YT-0218 · "Why am I seeing this?" explainability
`todo` · P1 · web · 3d · dep: YT-0216

- [ ] Every campaign card can show the reasons it was selected, in plain language
- [ ] "Not interested" adjusts the profile immediately and visibly
- [ ] Corrections are captured as a signal in their own right
