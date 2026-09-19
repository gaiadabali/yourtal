# YourTal — Web App, Performance & the Fraud Consequence

**Date:** 2026-09-18
**Decision:** YourTal ships as a **web application (PWA)**, not a native app. Most traffic will be mobile, but it must be excellent on mobile, tablet and desktop, and it must be fast.

This resolves open question **G3 / [D8]**. It is a good decision for distribution and speed of iteration — and it costs us the single strongest fraud control available to a rewards platform. Both halves need to be on the table.

---

## 1. What we gain

| Gain | Why it matters here |
|---|---|
| **No app store** | No 15–30% platform fee on any future paid feature; no review cycle; ship fixes in minutes. |
| **Link-and-QR distribution** | A merchant can put a QR on the counter and a user is watching in 5 seconds. For a merchant-driven acquisition model this is *better* than an app. |
| **One codebase, three form factors** | Mobile, tablet, desktop from one build. |
| **Instant updates** | No version fragmentation — critical when reward rules, question banks and compliance copy change. |
| **Frictionless first run** | The biggest drop-off in any rewards app is "install a 60 MB APK to earn IDR 2,000." That drop-off disappears. |
| **Cheap experimentation** | A/B tests, reward-curve changes and new campaign formats ship same-day. |

For a platform whose growth loop runs through *merchants handing users a link*, web is arguably the right answer on the merits, not merely an acceptable compromise.

## 2. What we lose — and this one is serious

**Native apps get hardware-backed attestation. Web does not.**

| Control | Native | Web |
|---|---|---|
| Play Integrity / App Attest (hardware-rooted device + app integrity) | ✅ | ❌ **none** |
| Emulator / rooted-device detection | Strong | Weak, spoofable |
| Tamper-proof client binary | Certificate pinning, obfuscation | ❌ DevTools is a supported feature of the platform |
| Device fingerprint entropy | High, stable | Falling — Safari ITP and privacy-sandbox changes are actively reducing it |
| Background/foreground enforcement | Reliable | Page Visibility API — decent, but defeatable |
| Playback verification | Full control of the player | MSE/hls.js, scriptable by the user |

The research named emulator farms and in-runtime bots as the dominant 2026 threat to reward apps, and named **server-side validation before crediting** as where abuse is actually caught. On web we lose the first line of defence entirely and must lean much harder on the rest.

### 2.1 The compensating stack — **rewritten after the assumption audit**

> **The original version of this section was wrong.** Four of its controls were verified in [`22-assumption-audit.md`](22-assumption-audit.md) and **do not hold**. The honest position is below.

**What failed, and why:**

| Control as originally claimed | Verdict |
|---|---|
| CDN segment-log cross-check — "strongest web-native control, no client cooperation" | **Does not hold.** Cloudflare Stream exposes no per-session or per-segment delivery data at any latency. Analytics is adaptively sampled at date/uid/country granularity. Worse, Stream bills *preload and buffering* as delivery, so "delivered" never meant "watched" — a curl loop would have faked a full watch |
| Indonesian SIM/NIK registration as an expensive identity anchor | **Does not hold.** The limit is 3 per NIK *per operator* by SMS and unbounded in-store — roughly 9 self-service SIMs per NIK. A prosecuted grey market sells pre-registered SIMs at Rp25–100k, and +62 OTP rental runs USD 0.01–0.10. Cost per phone-verified account: **cents** |
| WebAuthn passkeys as device binding | **Does not hold.** Consumer passkeys default to *synced*; Safari and Google Password Manager return no attestation; `devicePubKey` was dropped from WebAuthn L3 in Aug 2024; Chrome DevTools ships a scriptable virtual authenticator. 500 passkeys cost $0 |
| Wake Lock + Page Visibility as foreground enforcement | **Partial at best.** Wake Lock is spec-mandated to release the moment the document is hidden; no browser fires visibility change entering the app switcher; two `Object.defineProperty` calls defeat the check |
| Turnstile "raises per-account cost" | **Negligible.** Solving services charge ~$1.20–1.45 per 1,000 — about $0.0015 per account |

**Total attacker bill to stand up 500 accounts: under $150, mostly one-off.**

All five failed the same way: **pre-auth, per-session checks aimed at what is actually a post-auth, cross-account problem.**

### 2.1a What actually works instead

Stop trying to make account creation expensive. It cannot be done on the web, at this price point, in this market. Move the defence to **after earning and before value is realised**, and cap the damage rather than preventing the attempt.

| Control | Why this one holds |
|---|---|
| **Self-hosted HLS on R2 with signed per-session URLs** | Gives genuine per-segment delivery logs, which is what the original control needed. It also costs roughly **$0.0003 vs $0.03 per 30-minute view** — about 100× cheaper. See §2.1b |
| **Redemption friction as a control** | A voucher needing physical presence at a shop is a natural bottleneck a farm cannot cheaply cross |
| **Trust-tiered reward fungibility** | Low-trust accounts may only redeem physical-presence rewards. Fungible digital goods (pulsa, transport credit, e-vouchers) unlock only at higher trust |
| **Long holdback and graduated earning caps** | Value vests over time; detection is statistical and lags, so time is the control |
| **Economic caps** | Bound total extractable value per account per month, so farming 500 accounts yields a bounded, budgetable loss |
| **Cross-account graph detection** | Promoted from a Phase-2 supplement to **the primary control**, because the problem was always cross-account |
| **Payout-instrument uniqueness** (higher tiers) | Linking a KYC'd Indonesian e-wallet is a far stronger anchor than a phone number, because e-wallets are NIK-bound with real limits |
| Turnstile, fingerprinting, passkeys | **Keep them** — they still stop casual abuse, and passkeys remain genuinely valuable against phishing and account takeover. Just do not count them as anti-farm controls |

**The uncomfortable tension this creates:** the critique recommends moving low-minimum, high-utility rewards (pulsa, transport credit) into Phase 1 because they preserve perceived value. Those are also **exactly what a fraudster wants**, because they are instantly fungible. Restaurant vouchers are worse for users and naturally fraud-resistant. The trust-tier ladder above is what reconciles the two — it is not optional.

### 2.1b The video decision flips

Cloudflare Stream was chosen for zero operations, with a migration to self-hosted HLS deferred to ~5M delivered minutes/month. **The audit inverts that.** Self-hosting is now both the cheaper option *and* the only route to a working attention-verification control.

**Revised: Stream for the Phase −1 pilot only. Self-hosted HLS on R2 from Phase 1.** Roughly 2–4 weeks of engineering, bought back many times over on delivery cost alone. Supersedes [`10-tech-stack.md`](10-tech-stack.md) §4 and [`15-stack-locked.md`](15-stack-locked.md).

### 2.2 The escape hatch — plan it, don't build it

Wrap the same web app in **Capacitor** and ship it to the Play Store *if and only if* fraud losses justify it. That recovers **Play Integrity** on Android — where the overwhelming majority of Indonesian users are — for a few weeks of work, with no rewrite, because it is the same codebase.

**Trigger:** fraud loss exceeding ~3% of reward value issued for two consecutive months, or a single farm incident above a set threshold.

Keep this viable by choosing a stack Capacitor can wrap cleanly and by keeping all device-signal collection behind one interface with a web implementation and a future native one.

## 3. Performance — the real target device

The Core Web Vitals numbers that matter are **not** measured on an iPhone on Wi-Fi. The target is a **mid-tier Android phone on 4G in Jakarta** — roughly a 4× CPU slowdown against a desktop and highly variable RTT.

### 3.1 Budgets (enforced in CI, not aspirational)

| Metric | Budget | Measured on |
|---|---|---|
| **LCP** | **≤ 2.0 s** (hard fail at 2.5 s) | Moto G-class, 4G throttle |
| **INP** | ≤ 200 ms | same |
| **CLS** | ≤ 0.1 | same |
| **TTFB** | ≤ 600 ms | in-region edge |
| **Initial JS (shell route)** | **≤ 170 KB** gzipped | build-time check |
| **Time to first video frame** | **≤ 1.0 s** from tap | field telemetry |
| **Total shell transfer, cold** | ≤ 350 KB | build-time check |

**Fail the build on regression.** A performance budget that is not enforced by CI is a wish. Lighthouse CI on every PR, plus real-user monitoring (RUM) segmented by country, connection type and device class — because the p75 that matters is Indonesian mid-tier, and a Sydney-measured p75 will lie to you.

### 3.2 How we hit it

- **Next.js App Router with React Server Components.** Ship HTML, not a framework that then fetches the content. The feed, campaign cards and rewards store are server-rendered; interactivity is surgical.
- **Edge rendering in-region.** Jakarta and Sydney. A round trip to us-east-1 costs more than every optimisation below combined.
- **Route-level code splitting**, and the **video player bundle loads on intent** (tap), never in the shell.
- **No heavy UI framework.** Tailwind + a headless primitive library. No component kit that ships 300 KB to render a card.
- **One variable font, subsetted**, or system fonts. Latin + Indonesian needs no more.
- **AVIF/WebP via `next/image`**, explicit dimensions everywhere (CLS is mostly images without dimensions).
- **Aggressive caching**: static shell on the CDN, RSC payloads cached per segment, stale-while-revalidate on catalogue data.
- **Skeletons with correct dimensions**, never spinners — perceived performance is most of performance.
- **Service worker** for the app shell, the rewards catalogue and offline voucher display. A user must be able to open their voucher QR **in a shop with no signal**. That is a hard requirement, not a nicety.

### 3.3 Video on the web

- **HLS via `hls.js`**, native HLS on Safari. Cap the ABR ladder at 720p and **start at 360–480p on cellular**; use the Network Information API where available, and default conservatively where it is not.
- **Autoplay needs a user gesture** on mobile browsers — so the watch flow is explicitly tap-to-start. This is fine, and it doubles as the "you are agreeing to this trade" moment where we show duration, reward and data size.
- **Page Visibility API + focus events** pause reward accrual when the tab is backgrounded. Weaker than native, hence the CDN-log cross-check in §2.1.
- **Screen Wake Lock API** so the phone does not sleep during a 25-minute watch. Without this, long-form on web is broken.
- **Resume position** stored server-side, so a user can start on their phone and finish on a laptop.
- **Preload only the first segments**; never prefetch a 30-minute asset on cellular.

### 3.4 Responsive strategy

Two different products, two different priorities:

| Surface | Primary form factor | Notes |
|---|---|---|
| **User app** (feed, watch, rewards, wallet) | **Mobile-first** | Thumb-reachable controls, bottom navigation, full-bleed video, single column. Tablet and desktop get a wider layout — more columns, persistent nav — **not a different product**. |
| **Advertiser console** | **Desktop-first** | Campaign building, question authoring, creative upload and reporting are desk work. Must be *usable* on tablet; need not be pretty on a phone. |
| **Merchant portal** (redeem a voucher, check a code) | **Mobile-first, ruthlessly** | This runs on a cashier's phone in a busy shop. Two taps, huge targets, works offline, no login friction beyond a short-lived session. It is the most under-designed surface in most platforms like this and the one that decides whether merchants stay. |

## 4. PWA specifics

- **Installability is an onboarding step, not an afterthought.** Prompt at the first successful reward — the moment of peak goodwill — and give a points bonus for installing. On iOS, "Add to Home Screen" is a *prerequisite* for web push (16.4+), so it is worth the bonus.
- **Web push**: works well on Android Chrome (our majority), requires install on iOS. Budget for lower opt-in than native and lean harder on scheduled email/WhatsApp for re-engagement in Indonesia, where WhatsApp is the dominant channel.
- **Offline**: app shell, rewards catalogue, and — critically — **the user's active vouchers and their redemption QR**.
- Deep links: every campaign, voucher and merchant gets a real URL. This is a web-app superpower — merchants can link straight to their own campaign from their Instagram bio.

## 5. Consequential changes to the rest of the plan

| Doc | Change |
|---|---|
| [`02-architecture.md`](02-architecture.md) | Mobile question **[D8] resolved: web/PWA.** Device-signal collection becomes an interface with a web implementation; Capacitor is the documented escape hatch. |
| [`03-regulatory-and-risk.md`](03-regulatory-and-risk.md) | Risk #3 (device-farm extraction) rises from High to **the top risk**, because the strongest control is unavailable. Mitigation set replaced with §2.1 above. |
| [`04-roadmap.md`](04-roadmap.md) | Phase 0 adds performance budgets + RUM. Phase 1 adds passkey enrolment and the CDN-log cross-check — **these are launch controls, not phase-2 hardening.** |
| [`06`](06-longform-video-and-attention.md) | Checkpoint questions become more important, not less — on web they carry more of the fraud load. |
