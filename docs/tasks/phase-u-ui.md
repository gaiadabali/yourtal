# Phase U · UI first

**This is the next session's work.** Every task here builds against **typed mock fixtures**, not a running backend. Nothing in this phase depends on the ledger, the pricing engine or any service existing.

**Why UI first is the right call for a large investment:** a clickable product you can put in front of ten merchants and fifty users answers "will anyone want this" for a fraction of the 547 engineer-days that Phase 1 costs. It also produces the thing an investor actually reacts to. If the answers are bad, you have spent weeks instead of months.

**Rule for this whole phase:** fixtures live in `packages/contracts` as Zod schemas with mock generators, so the same types compile against the real API later. **No `any`, no untyped JSON blobs, no "we'll wire it up later" shortcuts.** The mock layer is a seam, not a throwaway.

---

## Foundation

### YT-0400 · Design tokens and theme
`todo` · PU · web · 3d · dep: —
- [ ] Colour, type, spacing, radius and elevation scales defined once, as CSS custom properties on `:root`
- [ ] Dark mode via `prefers-color-scheme` plus an explicit override attribute
- [ ] Contrast checked to WCAG AA on both themes, including the reward and price colours
- [ ] One variable font, subsetted to Latin + Indonesian

### YT-0401 · UI primitives
`todo` · PU · web · 5d · dep: YT-0400
- [ ] Button, Input, Select, Card, Sheet, Dialog, Toast, Skeleton, Tabs, Badge, Progress on Radix
- [ ] Every primitive keyboard-operable and screen-reader labelled
- [ ] Tested at 320 px width and at 200% browser zoom
- [ ] No file over 300 lines; no barrel files

### YT-0402 · App shell and responsive navigation
`todo` · PU · web · 4d · dep: YT-0401
- [ ] Five-tab bottom navigation on mobile; side navigation from `md`
- [ ] Safe-area insets handled for notched devices
- [ ] Route transitions with no layout shift
- [ ] Server-rendered shell; no client component above the fold

### YT-0403 · Typed mock data layer
`todo` · PU · web · 3d · dep: —
- [ ] Zod schemas in `packages/contracts` for campaign, listing, voucher, balance, business, question
- [ ] Deterministic seeded generators producing realistic Indonesian data (IDR amounts, Jakarta districts, real-sounding merchants)
- [ ] One switch flips every screen between mock and live
- [ ] Includes deliberately awkward fixtures: long merchant names, zero balance, expired voucher, sold-out listing

### YT-0404 · Performance budget harness
`todo` · PU · web · 2d · dep: YT-0402
- [ ] Lighthouse CI on every PR, throttled to mid-tier Android over 4G
- [ ] Fails the build on LCP > 2.0 s, INP > 200 ms, CLS > 0.1, initial JS > 170 KB
- [ ] Bundle-size report posted on the PR

## The earn loop

### YT-0410 · Earn board
`todo` · PU · web · 4d · dep: YT-0402, YT-0403
- [ ] Dense card grid; every card shows **duration · reward · estimated MB · merchant**
- [ ] Filter and sort controls; empty, loading and error states all designed
- [ ] Skeletons match final dimensions exactly so nothing shifts

### YT-0411 · Campaign entry card — the contract screen
`todo` · PU · web · 3d · dep: YT-0410
- [ ] States plainly: how long, what you earn, how much data, how many questions, and the scoring rule
- [ ] Terms shown here are the terms honoured — copy makes that explicit
- [ ] Single primary action; no dark patterns, no hidden duration

### YT-0412 · Long-form player UI
`todo` · PU · web · 5d · dep: YT-0411
- [ ] Chapter markers, progress, accrued reward visible throughout
- [ ] Quality selector defaulting to 360–480p with the data cost shown per option
- [ ] Resume prompt when a prior position exists
- [ ] Accrual visibly pauses when the tab is backgrounded

### YT-0413 · Checkpoint question UI
`todo` · PU · web · 4d · dep: YT-0412
- [ ] One question at a time, conversational, visible timer, shuffled options
- [ ] All five question types rendered: multiple choice, true/false, Likert, ranked, short text
- [ ] Fully keyboard and screen-reader accessible; timer announced, not only shown
- [ ] Result screen distinguishes base reward from accuracy bonus

### YT-0414 · Quick feed
`todo` · PU · web · 4d · dep: YT-0402, YT-0403
- [ ] Vertical swipeable feed of short campaigns with snap scrolling
- [ ] Never autoplays into an item the user did not navigate to
- [ ] Degrades to a list on desktop rather than faking a phone

## The spend loop

### YT-0420 · Store browse
`todo` · PU · web · 4d · dep: YT-0402, YT-0403
- [ ] Category, merchant, price-band and location filters
- [ ] Price in points shown with the live face value beside it
- [ ] Sold-out, expiring and newly-added states designed

### YT-0421 · Offer detail
`todo` · PU · web · 3d · dep: YT-0420
- [ ] Terms, minimum spend, transferability and partial-redemption policy **above the fold, before any action**
- [ ] Merchant, locations and how to redeem
- [ ] Insufficient-balance state shows exactly how much more is needed and how to earn it

### YT-0422 · Burn flow with price lock
`todo` · PU · web · 4d · dep: YT-0421
- [ ] Visible price-lock countdown from the moment the price is shown
- [ ] Confirmation step restates cost and terms
- [ ] Success, failure and lock-expired states all designed
- [ ] Holdback explained in plain language when it blocks a redemption

### YT-0423 · Wallet
`todo` · PU · web · 4d · dep: YT-0402, YT-0403
- [ ] Balance, pending-in-holdback with unlock dates, and expiring-soon
- [ ] History in plain language, never transaction codes
- [ ] Empty state teaches the loop rather than showing a zero

### YT-0424 · Voucher detail and offline QR
`todo` · PU · web · 3d · dep: YT-0423
- [ ] Rotating QR with a visible validity countdown
- [ ] Renders from cache with the network disabled — verified by test
- [ ] Per-merchant redemption instructions in the user's language
- [ ] Used and expired vouchers archived and still viewable

## Entry, exit and logged-out

### YT-0430 · Onboarding and phone OTP
`todo` · PU · web · 4d · dep: YT-0402
- [ ] Signup under 60 seconds on a throttled connection, measured
- [ ] Interest picker with images, 15 seconds to complete
- [ ] Per-purpose consent screens, specific and unambiguous, in Bahasa and English
- [ ] Resend, wrong-number and rate-limited states designed

### YT-0431 · Logged-out public pages
`todo` · PU · web · 4d · dep: YT-0410, YT-0420
- [ ] Public campaign, merchant, offer and catalogue pages, server-rendered
- [ ] One honest call to action naming the actual reward value
- [ ] Open Graph and share card metadata with a generated image

### YT-0432 · Open Viewing playback and conversion
`todo` · PU · web · 3d · dep: YT-0431, YT-0412
- [ ] Anonymous full playback with no reward UI, and no claim affordance anywhere
- [ ] Foregone reward shown honestly during playback
- [ ] Sign-up prompt at the point a rewarded viewer would have been paid
- [ ] Returns the user to exactly where they were after signup

### YT-0433 · Me, settings and consent controls
`todo` · PU · web · 3d · dep: YT-0430
- [ ] Per-purpose consent toggles that visibly take effect
- [ ] Language, interests, security, referrals
- [ ] Account deletion path present and honest about what happens to points

## Business and merchant

### YT-0440 · Business console shell
`todo` · PU · web · 3d · dep: YT-0401
- [ ] Desktop-first; three zones shown only when the business holds that relationship
- [ ] Usable at tablet width; no horizontal scrolling

### YT-0441 · Campaign builder
`todo` · PU · web · 5d · dep: YT-0440, YT-0403
- [ ] Upload with progress, chapter editing, reward configuration, targeting, budget
- [ ] Live preview of exactly what the user will see on the entry card
- [ ] Draft, in-review, live, paused and rejected states designed, with rejection reasons

### YT-0442 · Question bank authoring
`todo` · PU · web · 4d · dep: YT-0441
- [ ] All five question types, with correct-answer marking on scored types
- [ ] Bank-size rule enforced in the UI with an explanation, not a silent block
- [ ] PII-request rejection shown inline as the author types, with the reason

### YT-0443 · Business reports
`todo` · PU · web · 4d · dep: YT-0440, YT-0403
- [ ] Completion by chapter, question accuracy, recall score, redemption attribution
- [ ] Open views and rewarded views reported separately and never combinable
- [ ] Aggregates only; no interface path to a per-user answer exists

### YT-0444 · Team management
`todo` · PU · web · 3d · dep: YT-0440
- [ ] Invite, role assignment, removal, and the audit trail of team actions
- [ ] Two-person-approval flows shown for the actions that require them

### YT-0445 · Merchant redemption portal
`todo` · PU · merchant · 4d · dep: YT-0401
- [ ] Mobile-first: enter a code, confirm, done, in two taps
- [ ] Huge touch targets, readable in bright light, works one-handed
- [ ] Offline state queues and shows pending sync clearly
- [ ] Today's redemptions list with running total

### YT-0446 · Store device provisioning and PIN unlock
`todo` · PU · merchant · 3d · dep: YT-0445, YT-0444
- [ ] Admin provisions a named device bound to a location
- [ ] Short PIN unlocks the session; no personal login on a shared phone
- [ ] Revoke flow visible and immediate

## Prototype gate

### YT-0450 · Clickable prototype walkthrough
`todo` · PU · web · 3d · dep: YT-0413, YT-0424, YT-0432, YT-0445
- [ ] Every core journey completable end to end against mocks: earn, spend, redeem, open-view
- [ ] Deployed to a shareable URL with seeded data
- [ ] Runs acceptably on a real mid-tier Android over 4G, tested on a physical device

### YT-0451 · Merchant and user reaction sessions
`todo` · PU · pilot · 4d · dep: YT-0450
- [ ] Walk 10 merchants through the business console and the redemption portal
- [ ] Walk 15 users through earn, spend and redeem
- [ ] Record where they hesitate, what they misread, and what they ask for
- [ ] Findings feed the Phase 1 scope decision before a line of backend is written
