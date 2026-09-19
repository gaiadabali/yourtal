# Phase −1 · The pilot that costs nothing

Test the two assumptions the whole model rests on, before any engineering money is spent.
**Gate:** ≥40% completion on a 15-minute video, and one merchant who paid and wants to repeat.

---

### YT-0001 · Pilot: recruit a launch merchant
`todo` · P-1 · pilot · 3d · dep: —
- [ ] One merchant signed up in writing, with 70%+ gross margin on the voucher item
- [ ] They agree a voucher face value and a settlement value
- [ ] They agree to be quoted in the write-up

### YT-0002 · Pilot: produce the 15-minute video
`todo` · P-1 · pilot · 3d · dep: YT-0001
- [ ] 15 min of the merchant's own content, chaptered into 5 segments
- [ ] Hosted on Cloudflare Stream with a public signed link
- [ ] Encoded at 480p; measured file size recorded

### YT-0003 · Pilot: merchant authors the questions
`todo` · P-1 · pilot · 1d · dep: YT-0002
- [ ] 5 questions, answerable only from the video, 3 scored + 2 opinion
- [ ] Reviewed for PII harvesting and unanswerable items
- [ ] Question order and options randomised per respondent

### YT-0004 · Pilot: landing page + form
`todo` · P-1 · pilot · 2d · dep: YT-0003
- [ ] Entry card states duration, reward, and estimated MB before playback
- [ ] Watch position and drop-off timestamp captured per respondent
- [ ] Phone number collected for voucher delivery and de-duplication

### YT-0005 · Pilot: run traffic to 200 completions
`todo` · P-1 · pilot · 5d · dep: YT-0004
- [ ] ≥500 starts recorded, cheapest available channel
- [ ] Cost per completed view recorded
- [ ] Drop-off curve captured per chapter

### YT-0006 · Pilot: issue and track vouchers manually
`todo` · P-1 · pilot · 3d · dep: YT-0005
- [ ] Vouchers issued by hand with unique codes in a spreadsheet
- [ ] In-store redemptions reconciled with the merchant weekly
- [ ] Redemption rate recorded

### YT-0007 · Pilot: get the merchant to actually pay
`todo` · P-1 · pilot · 2d · dep: YT-0006
- [ ] A price per completed verified view is quoted and invoiced
- [ ] The invoice is paid
- [ ] The merchant states in writing whether they would repeat, and at what price

### YT-0008 · Pilot: write up and take the gate decision
`todo` · P-1 · pilot · 2d · dep: YT-0007
- [ ] Completion rate, drop-off curve, redemption rate, CPCV, data-cost objections documented
- [ ] Go / no-go / pivot decision recorded with reasoning
- [ ] If no-go, the revised model is written before Phase 0 starts

## Spikes — run alongside the pilot, before Phase 0 scope is fixed

These change the architecture. All are cheap and all gate decisions already made.

### YT-0220 · Spike: self-hosted HLS on R2
`todo` · P-1 · media · 5d · dep: —
- [ ] ffmpeg transcode to an ABR ladder, HLS packaging, upload to R2
- [ ] Signed per-session segment URLs, and confirm per-segment request logs are actually retrievable
- [ ] Measure real delivery cost per 30-minute view against the Cloudflare Stream equivalent
- [ ] Decide: does this restore a usable attention check, and at what engineering cost

### YT-0221 · Spike: does phone verification earn its friction?
`todo` · P-1 · risk · 3d · dep: —
- [ ] Measure the block rate against commercial +62 OTP-rental services
- [ ] Price the realistic attacker cost per verified account
- [ ] Measure the signup conversion cost of requiring it
- [ ] Decide: keep, make optional, or replace with a higher-tier e-wallet link

### YT-0222 · Spike: bounded-loss economic model
`todo` · P-1 · economy · 3d · dep: —
- [ ] Model total extractable value per account per month under the proposed caps
- [ ] Compute the loss if 500 farmed accounts run at the cap for 90 days
- [ ] Set the real fraud-loss budget from this, replacing the unfounded 2% figure

### YT-0223 · Spike: incremental vs subsidised redemption
`todo` · P-1 · pilot · 2d · dep: YT-0006
- [ ] Survey pilot redeemers: would you have visited without the voucher?
- [ ] Split realised value from face value
- [ ] Feeds the reward-mix decision and the CAC pricing model

### YT-0224 · Trust-tiered reward fungibility
`todo` · P0 · risk · 3d · dep: YT-0054, YT-0222
- [ ] Low-trust accounts may redeem physical-presence rewards only
- [ ] Fungible digital goods (pulsa, transport credit, e-vouchers) unlock at higher tiers
- [ ] Tier thresholds and unlock rules are configurable without a deploy

### YT-0225 · Self-hosted HLS pipeline
`todo` · P0 · media · 10d · dep: YT-0220
- [ ] Transcode workers, HLS packaging, R2 storage, signed per-session URLs
- [ ] Per-segment delivery logs land where the watch session can verify against them
- [ ] Cloudflare Stream retained only as the pilot fallback
- [ ] Delivery cost per view measured and reported to finance

### YT-0226 · Merchant renewal instrumentation
`todo` · P-1 · pilot · 2d · dep: YT-0007
- [ ] Track whether pilot merchants renew, and at what price
- [ ] Track repeat full-price visits by voucher redeemers where the merchant can report it
- [ ] This replaces redemption rate as the Gate 1 headline metric
