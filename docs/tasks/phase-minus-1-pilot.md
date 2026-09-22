# Phase −1 · The pilot that costs nothing

Test the two assumptions the whole model rests on, before any engineering money is spent.
**Gate:** ≥40% completion on a 15-minute video, and one merchant who paid and wants to repeat.

> **The first merchant is snap-app — a sister company, not an arm's-length buyer.**
> That is the right choice for shaking out the mechanics, and snap-app is also the first
> YourtalID integration ([`02`](../02-architecture.md) § sister apps). But an invoice paid
> between entities the founder controls is an internal transfer: it does **not** test
> willingness to pay, so on its own it does **not** clear this gate. **A second, external
> merchant must complete YT-0001 → YT-0007 before the YT-0008 gate decision carries
> any weight.** Record snap-app's numbers and the external merchant's numbers separately;
> do not pool them.

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
- [ ] Watch position and drop-off timestamp captured per respondent **via client-side
      player telemetry**, and labelled as such wherever the number is reported. Cloudflare
      Stream exposes no per-session or per-segment data and bills preload as delivery
      ([`23`](../23-critique.md) §1.0), so this measures _honest drop-off_ only — it is
      **not** fraud-resistant and this pilot's completion figure must never later be quoted
      as a verified-attention number.
- [ ] Phone number collected for voucher delivery and de-duplication

### YT-0005 · Pilot: run traffic to a fixed 500 starts
`todo` · P-1 · pilot · 5d · dep: YT-0004

- [ ] Exactly 500 starts bought, cheapest available channel, then **stop** — whatever the
      completion count turns out to be. Do **not** keep buying traffic until some target
      number of completions is reached: the completion _rate_ is the thing under test, and
      spending past 500 starts to manufacture a completion _count_ destroys the experiment
      and the "costs nothing" premise. A low rate at 500 starts is a **result**, not a
      shortfall to be bought around.
- [ ] Completion rate reported as completions ÷ starts, with the raw counts
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
- ⚠️ **A figure from this ticket is being cited elsewhere as a FINDING of this ticket, and this ticket has not measured anything.** `yourtal-6c` reported it and `yourtal-ca` verified it at source; confirmed again here. YT-0110's re-parenting note attributes *"~100× cheaper"* to a YT-0220 finding. **Its actual origin is `docs/08-web-app-and-performance.md:62`** — *"\$0.0003 vs \$0.03 per 30-minute view — about 100× cheaper"* — sitting in a **table row under a "Why this one holds" column, describing an OPTION.** It is a design-document estimate
- ⛔ **This ticket's third criterion is literally *"measure real delivery cost"*, and it is unticked.** So a design estimate has been promoted to a measurement **by being cited as one**, and **YT-0110's dependency graph was restructured on it.** That is the deferral rule in its sharpest form: a note asserting the state of *another* ticket, where the other ticket is at 0/4
- ⛔ **The signing half of criterion 2 does not exist either**: **zero hits** for `presign`, `signature`, `hmac`, `expiry` or `expires` anywhere in `packages/media/src`. The origin serves an anonymous `hls/`-only grant (YT-0521), which is not the same thing as **signed per-session URLs**, and the per-segment delivery logs the whole control depends on need the latter
- ℹ️ **Recorded as 0/4 and that is CORRECT** — the concern is not that the board understates it. It is that the parts which do exist are being cited as though the measurement had happened. **This ticket is now `media`'s widest gate at 24 open tickets downstream**, so the citation matters more than it did
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
