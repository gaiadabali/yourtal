# YourTal — Assumption Audit: the facts the fraud model stands on

**Date:** 2026-09-19 · **Scope:** the load-bearing *factual* claims in [`08-web-app-and-performance.md`](08-web-app-and-performance.md) §2.1, §2.2 and §3.3.

The web/PWA decision is sound. Several of the facts underneath it are not. This document attacks them one at a time. Where a claim fails, the row says so in the first line — no burying it.

**Four of the nine do not hold, and they include all three controls `08` names as its strongest.** The CDN segment-log cross-check ("strongest web-native control") does not exist on our CDN. The SIM/NIK anchor ("best single control") costs an attacker cents. Passkey device-binding is not device-binding. Page Visibility is not a control. What is left is real but much thinner than the plan reads.

| # | Claim in `08` | Verdict |
|---|---|---|
| 1 | CDN segment-log cross-check, "needs no client cooperation", strongest web-native control | ❌ **does not hold** |
| 2 | Screen Wake Lock — without it long-form web is broken | ⚠️ partially holds |
| 3 | Page Visibility API pauses accrual on backgrounding | ⚠️ holds as UX, ❌ **does not hold** as a control |
| 4 | WebAuthn passkey is hardware-bound, makes 500 browser profiles much harder | ❌ **does not hold** |
| 5 | Fingerprint entropy is falling; weight it lower | ✅ holds — falling faster than stated |
| 6 | Turnstile raises per-account cost | ⚠️ partially holds — cost is ~$0.0015 |
| 7 | Indonesian NIK/KK SIM rules make phone-verified accounts expensive to farm | ❌ **does not hold** |
| 8 | Stream pricing, per delivered minute regardless of bitrate | ✅ holds |
| 9 | Capacitor wrap recovers Play Integrity | ⚠️ partially holds — and not where it matters |

---

## 1. The CDN segment-log cross-check — ❌ DOES NOT HOLD

> **The claim (`08` §2.1):** *"Cross-check claimed playback position against CDN segment-delivery logs. A client claiming minute 22 that only fetched 4 minutes of segments is lying. This is the strongest web-native control we have and it needs no client cooperation."*

**This control does not exist on Cloudflare Stream.** Not "is hard", not "needs a spike" — the data is not exposed at any latency or granularity.

| Question | Evidence | Answer |
|---|---|---|
| Does Stream have a Logpush dataset? | [Zone-scoped datasets](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/) = Account Abuse, DNS, Firewall, **HTTP requests**, NEL, Page Shield, Spectrum, WebSocket, Zaraz. No Stream dataset. | **No.** |
| Does `http_requests` catch it? | Stream serves from `https://customer-<CODE>.cloudflarestream.com/<UID>/manifest/video.m3u8` — [Cloudflare's own zone, not yours](https://developers.cloudflare.com/stream/viewing-videos/using-own-player/). Zone Logpush only covers zones you own. | **No.** |
| Can I proxy segments through my Worker to generate logs? | Cloudflare: *"Do not cache, proxy, or store manifests; always read them directly from Stream."* ([same page](https://developers.cloudflare.com/stream/viewing-videos/using-own-player/)) | **Explicitly unsupported.** |
| What does the analytics API give me? | [`streamMinutesViewedAdaptiveGroups`](https://developers.cloudflare.com/stream/getting-analytics/fetching-bulk-analytics/), dimensions **`date`, `datetime`, `uid`, `clientCountryName`, `creator`** only. 90-day retention. | **No viewer, session, IP or segment dimension.** |
| Is that data even exact? | The `Adaptive` suffix means [adaptive sampling](https://developers.cloudflare.com/analytics/graphql-api/sampling/) — *"as the volume of records grows larger, progressively lower sample rates are applied."* | **Sampled. Unusable for adjudicating one account.** |
| Is there DRM licence-renewal telemetry as a fallback heartbeat? | Stream has no Widevine/FairPlay; access control is signed URLs only ([Secure your Stream](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/)). | **No.** |

**And it would be weaker than claimed even if the logs existed.** Cloudflare bills by *"HTTP requests for video segments"* and states plainly: **"Client-side preloading and buffering is counted as billable delivery"** ([pricing](https://developers.cloudflare.com/stream/pricing/)). Delivery proves bytes moved, not that a human watched. `hls.js` defaults to `maxBufferLength: 30`s and an attacker simply raises it ([hls.js API](https://github.com/video-dev/hls.js/blob/master/docs/API.md)) — a `curl` loop can pull all 450 four-second segments of a 30-minute video in seconds and then claim a full watch. The control is an **upper bound** ("you cannot claim more than was delivered"), not proof of attention. The plan promoted a ceiling check to its primary defence.

Signed URLs do not rescue it: tokens are [per-video, max 24 h expiry](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/), there is no session identifier, and even a per-session token buys nothing because you never see the request log. (Generic CDN wisdom that per-session URLs shred cache hit ratio is [real](https://blog.blazingcdn.com/en-us/cdn-signed-urls-and-token-authentication-explained) but moot here — Stream owns its own cache and does not expose the key.)

### What to do instead

| Option | Gets you segment-level truth? | Cost / effort |
|---|---|---|
| **A. Self-host HLS on R2 behind a Worker** — transcode yourself, sign each segment URL with a session id, log every fetch | ✅ Yes. [R2 Data Access Logs](https://developers.cloudflare.com/changelog/post/2026-09-04-r2-data-access-logs/) (async, best-effort) + Workers Logpush give per-request records | Delivery ≈ **$0.0003 / 30-min view** (450 Class B ops at [$0.36/M](https://developers.cloudflare.com/r2/pricing/) + Worker requests, [zero egress](https://developers.cloudflare.com/r2/pricing/)) vs **$0.03** on Stream — ~100× cheaper. You buy the transcode pipeline and the ABR packaging yourself. |
| **B. Tamper-evident client heartbeat** — server issues a one-time nonce per interval, client must return it *with* the answer to a content-derived micro-challenge; nonces are non-replayable and strictly ordered | Partly — it needs client cooperation but detects replay, fast-forward and parallel sessions | Cheap. This is the honest replacement for the "no client cooperation" claim. |
| **C. Mux / a vendor with per-view data** | ❌ Not really — Mux Data is a **client-side beacon**, so it is client-reported too ([Mux vs Stream](https://www.mux.com/compare/cloudflare-stream)) | Don't buy this expecting server truth. |

**Recommendation:** keep Stream for P0 (it is cheap and good), but **delete the CDN cross-check from the launch control set**, raise the weight on checkpoint questions (`06` §4–5) and on the holdback, and put **option A** on the roadmap as the trigger-fired hardening step — it is a better trigger than the Capacitor wrap, because it is cheaper *and* it actually produces the evidence.

**Spike (2 days):** upload a 10-minute asset to Stream, play it in `hls.js`, then separately `curl` every segment. Query `streamMinutesViewedAdaptiveGroups` hourly for 24 h. Record: (a) how long until the minutes appear, (b) whether the scraped and watched sessions are distinguishable by *any* dimension. Expected answer: no. Falsify me.

---

## 2. Screen Wake Lock API — ⚠️ PARTIALLY HOLDS

> **The claim (`08` §3.3):** *"Screen Wake Lock API so the phone does not sleep during a 25-minute watch. Without this, long-form on web is broken."*

Support is fine. The **semantics** are narrower than the plan assumes.

| Point | Evidence |
|---|---|
| Support is good | [caniuse: 94.92% global](https://caniuse.com/wake-lock); Chrome 85+, Firefox 126+, Samsung 14+, **iOS Safari 16.4+** ([WebKit release notes](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)). MDN marks it **Baseline "newly available" since March 2025** — new, not mature. |
| **It dies the moment the page is hidden** | [W3C spec](https://www.w3.org/TR/screen-wake-lock/), normative: *"If document's visibility state is `hidden`, return a promise rejected with `NotAllowedError`"* and on visibility change *"for each lock … run release a wake lock."* [Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock): released when you minimise or switch tab. |
| **It was a no-op in installed iOS PWAs until 18.4** | [WebKit bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545), filed 2023, **RESOLVED FIXED 2025-03-31 / iOS 18.4**. Our onboarding pushes Add-to-Home-Screen (`08` §4) — that is exactly the configuration that silently failed. |
| **Low Power Mode overrides it** | Spec permits UAs to ignore requests under power saving; rejection surfaces as `NotAllowedError` most apps swallow. Indonesian mid-tier phones on 20% battery are our modal user. |
| **No fallback exists** | `NoSleep.js` is [~6 years stale](https://www.npmjs.com/package/nosleep.js); the silent-looping-video hack is dead on modern iOS. You get the API or nothing. |

**Verdict:** the *positive* claim holds — you should ship it, and without it a 25-minute watch on a 30-second auto-lock is genuinely miserable. The *implied* claim — that it keeps a long watch alive — does not. It prevents dimming **while the user is looking at a visible tab**, nothing more.

**What to do:** request on the play gesture; handle `NotAllowedError` **loudly** (telemetry, not a swallowed catch); re-acquire on `visibilitychange`; show a visible "screen stays on" indicator; gate iOS PWA users below 18.4 with an in-app nudge. And design reward accrual so a dropped lock is recoverable — server-side resume position already does most of this.

---

## 3. Page Visibility / foreground enforcement — ❌ DOES NOT HOLD as a control

> **The claim (`08` §3.3):** *"Page Visibility API + focus events pause reward accrual when the tab is backgrounded."* Listed in §2 as *"decent, but defeatable."* **"Decent" is too generous in both directions.**

**It is unreliable against honest users.** W3C's own tracker: *"no browser fires the `visibilitychange` event when first entering the App/Tab Switcher"* ([w3c/page-visibility#59](https://github.com/w3c/page-visibility/issues/59), still unresolved — the repo was archived read-only in 2022). Firefox deliberately suppresses the event when audio is playing and the device is locked ([bug 910340, WONTFIX](https://bugzilla.mozilla.org/show_bug.cgi?id=910340)). Safari does not fire it on navigation ([WebKit 151234](https://bugs.webkit.org/show_bug.cgi?id=151234)). MDN warns `blur`/`focus` are not substitutes.

**It is trivial against a dishonest one.** Two `Object.defineProperty` calls pin `document.hidden = false`, and wrapping `addEventListener` drops `visibilitychange` entirely — [published as a copy-paste browser extension and userscript](https://www.w3tutorials.net/blog/spoof-or-disable-the-page-visibility-api/). Automation does not even need that: `puppeteer-extra-plugin-stealth` injects via `evaluateOnNewDocument` so the patch lands **before any of our code runs**, and a headless browser never backgrounds the page anyway. Chrome DevTools' "Emulate a focused page" checkbox defeats it with zero code. Neither the [WHATWG spec](https://html.spec.whatwg.org/multipage/interaction.html#page-visibility) nor [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) makes any integrity claim — the API is framed purely as a resource hint.

**Timer-throttling as a side channel doesn't save it either:** [Chrome's intensive throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) exempts pages that played audio in the last 30s — i.e. our video playback erases the very signal we'd infer backgrounding from.

**Verdict:** ship it to pause playback and save the user's data. **Never let it gate money.** Score it as a weak behavioural signal alongside touch cadence; treat a session that *never* reports a visibility change across 30 minutes as suspicious rather than clean.

---

## 4. WebAuthn passkeys as device binding — ❌ DOES NOT HOLD

> **The claim (`08` §2.1):** *"A passkey is bound to the device's secure enclave … it makes 'one operator, 500 browser profiles' much harder."*

Both halves are wrong.

| Sub-claim | Evidence | Status |
|---|---|---|
| "Bound to the secure enclave" | FIDO itself splits passkeys into **synced** and **device-bound**; consumer passkeys default to synced via iCloud Keychain / Google Password Manager, and GPM now [syncs Android ↔ desktop Chrome](https://developer.chrome.com/blog/passkeys-gpm-desktop). See [FIDO](https://fidoalliance.org/passkeys/), [passkeys.dev](https://passkeys.dev/docs/reference/terms/). | ❌ false for the default case |
| "Can I at least detect a synced credential?" | Yes — the **BE** flag (bit 3) is set at creation and [permanent](https://www.w3.org/TR/webauthn-3/); **BS** (bit 4) shows current backup state. [Yubico RP guidance](https://developers.yubico.com/Passkeys/Passkey_relying_party_implementation_guidance/High_assurance_passkey_relying_party.html). | ✅ but useless here — BE says *syncable*, not *which device* or *how many* |
| "Device-bound attestation on the web" | Safari returns **no attestation statement** for platform passkeys ([Apple forums](https://developer.apple.com/forums/thread/713195), [Corbado](https://www.corbado.com/blog/passkey-providers/why-some-platforms-do-not-support-attestation-for-passkeys)); same for GPM. You get an **AAGUID** identifying the *provider model* — shared by hundreds of millions. Enterprise attestation is managed-device only. | ❌ not available to a consumer site |
| "`devicePubKey` will give us a per-device key" | Renamed to `supplementalPubKeys` ([PR #1957](https://github.com/w3c/webauthn/pull/1957)) then **dropped entirely** ([PR #2109, merged 2024-08-07](https://github.com/w3c/webauthn/pull/2109)) for lack of two interoperable implementations. WebAuthn L3 as published has neither. | ❌ **dead spec** |
| "Raises the cost of 500 accounts" | Nothing limits passkeys per device — Apple's own answer to "how do I limit registrations" is that *"a device is not a credential, nor is it guaranteed to represent a single human"* ([forum](https://developer.apple.com/forums/thread/732735)). Chrome DevTools ships a fully **software virtual authenticator driven over CDP** ([docs](https://developer.chrome.com/docs/devtools/webauthn)); standalone software authenticators mint ES256 keypairs in ~50 lines. | ❌ **marginal cost: $0** |

Every registration mints a fresh, unlinkable keypair by design. Two passkeys created on the same phone for two accounts are cryptographically indistinguishable from two passkeys on two phones. **A passkey proves the same keypair came back — not that a distinct human or device is behind it.**

**What to do:** keep passkeys. They are a genuine phishing/ATO win and good PWA UX, and the points bonus for enrolling is still worth paying. **Re-file them under "account security", not "device binding", and remove them from the anti-farm column of `08` §2.1.** Rejecting BE=1 would break honest iPhone users and push the attacker onto a software authenticator — do not do it.

---

## 5. Device fingerprinting entropy in 2026 — ✅ HOLDS (and the plan under-states it)

> **The claim (`08` §2.1, §2):** *"Falling — Safari ITP and privacy-sandbox changes are actively reducing it … weighted lower than it would be natively. Assume it degrades over time."*

Correct, and the degradation is sharper than "over time" implies:

- **Safari 26 ships Advanced Fingerprinting Protection ON BY DEFAULT in all browsing modes** — noise injected into 2D canvas, WebGL readback and WebAudio sample reads; screen/window metrics clamped to fixed values ([Stape](https://stape.io/news/safari-ios26-advanced-fingerprinting-protection), [9to5Mac](https://9to5mac.com/2025/07/29/with-ios-26-safari-will-counter-one-of-the-webs-most-invasive-tracking-methods/)). That is a direct hit on canvas + WebGL + audio, the three highest-entropy signals.
- **Chrome** froze the UA string and gates high-entropy client hints behind explicit request ([Corbado](https://www.corbado.com/blog/client-hints-user-agent-chrome-safari-firefox)). **Firefox** ships RFP-style canvas noise and font restriction.
- Durable entropy is migrating *below* the JS surface — TLS JA3/JA4, HTTP/2 frame ordering, IP reputation. Those are **Cloudflare signals we already have**, not things a fingerprinting SDK sells us.

**Read the vendor number correctly.** Fingerprint Pro's **99.5%** is defined by the vendor as *"how many returning visitors … they successfully identify as a returning visitor and not as a new visitor,"* achieved by combining fingerprinting with IP, visit timing and URL patterns ([Fingerprint](https://fingerprint.com/blog/fingerprintjs-fingerprint-pro-device-identification-accuracy-explained/)). **That is recall on cooperative returning users — the opposite of our threat model.** No independent validation exists; academic work finds uniqueness [varies sharply by demographic](https://petsymposium.org/popets/2025/popets-2025-0038.pdf) and fingerprints [drift over time](https://dl.acm.org/doi/10.1145/3419394.3423614). Open-source FingerprintJS is ~40–60% and its `confidence` field is a [cosmetic transform](https://blog.crawlex.net/blog/fingerprintjs-internals/).

**And the counter-measure is coffee money.** Anti-detect browsers spoof canvas/WebGL/fonts/audio/UA-CH per profile: Dolphin Anty ~**$10/mo for 60 profiles**, GoLogin **$24/mo**, AdsPower free tier ([comparison](https://afina.io/en/blog/best-antidetect-browsers-comparison-2026)). Pairing each profile with a distinct residential IP costs **$0.49–$1.00/GB** ([Evomi](https://evomi.com/product/residential-proxies), [DataImpulse](https://dataimpulse.com/blog/residential-proxy-pricing-comparison/)) — a few dollars for 500 light profiles.

**Verdict: holds.** Buy it, and buy it for the job it does — it reliably links the *lazy* multi-accounter (one machine, one browser, no proxy), which is most real voucher farmers. **Treat a fingerprint match as strong evidence when it fires and as zero evidence when it does not.** Absence of a match is not evidence of a distinct human. Use it as a feature in the graph (`08` §2.1 last row), never as a gate.

---

## 6. Cloudflare Turnstile — ⚠️ PARTIALLY HOLDS

> **The claim (`08` §2.1):** *"Turnstile at registration and at reward claim … Raises per-account cost."*

It does raise cost. By about **a seventh of a cent.**

Cloudflare's own framing is narrow: Turnstile *"performs client-side security challenges … to distinguish human visitors from automated traffic"* ([docs](https://developers.cloudflare.com/turnstile/)). It never claims to identify unique humans or deduplicate accounts — those are separate products. **Turnstile answers "is a browser driven by something human-ish here?" A farmer is, or rents, a human.**

Published solver pricing, 2026: [2Captcha **$1.45/1,000**](https://2captcha.com/p/cloudflare-turnstile), [CapSolver **~$1.20/1,000**](https://www.capsolver.com/products/cloudflare), [CapMonster](https://capmonster.cloud/en/cloudflare-turnstile/), flat-rate entrants at [$10–20/month unlimited](https://capskip.com/cloudflare-turnstile-solver/). Scrapfly's [teardown](https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-turnstile) is the most honest public analysis — solver APIs score "Low" against Interactive mode, but managed cloud-browser stacks score "Very high" across all modes.

**Cost to stand up 500 accounts plus a few thousand logins: $3–10, one-off.**

**Verdict:** keep it — it is free, low-friction, and strips out the drive-by noise floor so the fraud team sees signal. **Delete the words "raises per-account cost" from its row in `08` §2.1 and set Interactive (not Managed) mode on the reward-claim path.** It is a noise filter, not an economic barrier.

---

## 7. Indonesian SIM / NIK registration as an identity anchor — ❌ DOES NOT HOLD

> **The claim (`08` §2.1):** *"prepaid SIM registration is tied to NIK/KK with per-NIK limits, so phone-verified accounts are genuinely expensive to farm. This is our best single control."*

The regulation is real. The economics the plan infers from it are not.

**The actual rule.** Permenkominfo 12/2016 as amended by 14/2017 and 21/2017; NIK + KK validated against Dukcapil; mandatory from 31 Oct 2017 ([Kominfo](https://www.kominfo.go.id/content/detail/10874/)).

**The actual limit — and the hole in it.** Pasal 11(1) of 21/2017 caps **self-registration by SMS at 3 numbers per NIK *per operator***, not 3 in total ([Komdigi/DJPPI](https://djppi.komdigi.go.id/news/penerapan-registrasi-kartu-prabayar-1-nik-tidak-bisa-lebih-dari-3-nomor)). The 4th and beyond are still registrable **in person at the operator's gerai** with assisted verification ([Liputan6](https://www.liputan6.com/tekno/read/3148923/)). With three operator groups post-[XLSmart merger](https://en.wikipedia.org/wiki/XLSmart) (Telkomsel, Indosat Ooredoo Hutchison, XLSmart), the self-service floor is **~9 SIMs per NIK** and the real ceiling is unbounded. "Per-NIK limits" as a cost driver is a misreading.

**The grey market is mature and prosecuted.** Pre-registered "siap pakai" starter packs sell openly on Tokopedia/Shopee at roughly **Rp25k–100k (USD 1.5–6)**. Arrests confirm the method: four sellers in Tangerang registering cards with **NIK/KK found via Google** ([Kompas](https://megapolitan.kompas.com/read/2022/03/30/23193761/)); one seller in Batang moving **thousands of cards for ~Rp15M/month** ([Detik](https://www.detik.com/jateng/hukum-dan-kriminal/d-6607751/)).

**Identity supply is not scarce.** ~1.3 billion SIM-registration records (NIK + MSISDN + operator) were dumped in 2022 ([Rest of World](https://restofworld.org/2022/indonesia-hacked-sim-bjorka/), [Jakarta Post](https://www.thejakartapost.com/paper/2022/09/02/ministry-denies-role-in-reported-leak-of-1-3b-phone-registrations.html)); ~279M BPJS Kesehatan records in 2021 ([Tempo](https://en.tempo.co/read/1469740/)). Valid NIK/KK pairs are a commodity download.

**And you don't need a SIM at all.** +62 OTP rental: [5SIM lists Indonesian numbers from ~USD 0.06](https://5sim.net/countries/indonesia) with tens of millions in stock; [SMSPVA rents +62](https://smspva.com/rent/country/indonesia) from under a cent per one-time code.

**Biometrics change the trajectory, not today's cost.** Ministerial Regulation 7/2026 moves registration to face recognition with ISO 30107 liveness: voluntary from 1 Jan 2026, **mandatory for new subscribers from 1 Jul 2026**, with the ~291M existing base still voluntary — only ~10M verified by July 2026, and reporting notes the scheme *"cannot prevent sellers from registering SIMs using their own faces rather than customers'"* ([TechTimes](https://www.techtimes.com/articles/321560/20260725/indonesias-biometric-sim-drive-hits-10-million-targets-291-million-existing-subscribers.htm), [Bisnis](https://teknologi.bisnis.com/read/20251217/101/1937610/)).

**Verdict: does not hold.** Realistic attacker cost per phone-verified account is **USD 0.01–0.10** via OTP rental, or **USD 1.5–6** for a physical pre-registered SIM. Against a voucher-scale reward that is not a deterrent — it is a rounding error. Phone verification is a *deduplication key and a nuisance tax*, not an identity anchor, and it must not be the "best single control."

**What to do instead:**
- **Detect rental ranges.** Twilio Lookup / Telesign line-type + carrier + reachability at signup; hard-block known virtual/VoIP ranges and score MVNO/rental prefixes down. Re-check at first payout, not only at signup.
- **Move the anchor to the payout leg.** The scarce, expensive, KYC'd identity in Indonesia is the **e-wallet / bank account** (GoPay, OVO, DANA, ShopeePay are PJP-licensed and KYC'd). Bind redemption to a verified payout destination, enforce **one payout destination per account and one account per payout destination**, and treat a reused destination as a hard cluster edge. This is the control the plan thought it was getting from SIMs.
- **Raise the holdback,** as `08` already says — with the SIM anchor gone, 72 h for new accounts is the floor, not the target.
- **Make farming unprofitable rather than impossible:** reduced earn rate + longer holdback for untrusted tiers already in the plan now carries materially more weight.

---

## 8. Cloudflare Stream pricing and per-minute billing — ✅ HOLDS

> **The claim:** delivery is billed per delivered minute regardless of bitrate.

Confirmed against [Stream pricing](https://developers.cloudflare.com/stream/pricing/):

| Item | Published |
|---|---|
| Storage | **$5 / month per 1,000 minutes** of capacity, prepaid in $5 increments |
| Delivery | **$1 per 1,000 minutes delivered**, post-paid |
| Egress | **None.** *"Bandwidth is already included in 'video delivered' with no additional egress fees."* |
| Bitrate/resolution | Not a factor — billing is duration-based |
| Measurement | *"Delivery is counted by HTTP requests for video segments or parts of the MP4"*, rounded to segment length (**4 s** for uploaded content) |
| Live | Same model; recorded live consumes storage. WebRTC delivery becomes billable **15 Oct 2026** |

**Two things the plan has not priced in, both from the same page:**

1. **"Client-side preloading and buffering is counted as billable delivery."** A 30-minute asset costs **$0.03 per full view**. That is fine for legitimate traffic, but it also means **a segment-scraping bot burns our money at full rate** — a farm pulling 100k video-lengths/month costs us **$3,000/month in delivery alone** whether or not a single point is ever paid out. Add Stream delivery spend to the fraud-loss trigger in `08` §2.2, not just reward value issued.
2. Cost per legitimate view is ~$0.03 against a voucher-scale reward — it does not dominate unit economics, but it is not free either. At 1M views/month that is **$1,000/month**, which is the point where self-hosting on R2 (§1, option A) pays for itself on cost alone, before you count the fraud logs it unlocks.

---

## 9. Capacitor wrap recovering Play Integrity — ⚠️ PARTIALLY HOLDS

> **The claim (`08` §2.2):** *"Wrap the same web app in Capacitor … That recovers Play Integrity … for a few weeks of work, with no rewrite."*

**True part:** shipping a Capacitor build through Play does get a genuine, hardware-anchored attestation of **device state and APK signature** — `PLAY_RECOGNIZED` app verdict plus `MEETS_BASIC/DEVICE/STRONG_INTEGRITY` ([verdict reference](https://developer.android.com/google/play/integrity/verdicts)). The effort estimate is fair.

**Where it misleads:** Play Integrity attests the **container**, never the **payload**. A Capacitor app's logic is web content; if it is loaded remotely (Capacitor's `server.url`, or any remote-update scheme) it is code Play Integrity never measured. And even a fully genuine install can have its WebView scripted — `setWebContentsDebuggingEnabled`, remote DevTools, or Frida on a rooted device — while the attestation still reports `PLAY_RECOGNIZED` + `MEETS_DEVICE_INTEGRITY` ([bypass writeup](https://hacktricks.wiki/en/mobile-pentesting/android-app-pentesting/play-integrity-attestation-bypass.html), [Capacitor remote content](https://capawesome.io/blog/the-right-way-to-update-your-capacitor-app-remotely/)).

**And the weaker verdicts are routinely spoofed.** Play Integrity Fix / PIF Next (Zygisk modules for Magisk/KernelSU) restore `MEETS_DEVICE_INTEGRITY` on rooted Android 8–16 — expected result is explicitly BASIC + DEVICE pass, **STRONG fail** ([PIF](https://github.com/KOWX712/PlayIntegrityFix)). Reaching STRONG needs a leaked, un-revoked hardware keybox, and Google revokes abused keyboxes at scale ([analysis](https://iamjosephmj.medium.com/a-technical-autopsy-of-the-android-trust-model-9dafc9ab08d4)). So: **`MEETS_STRONG_INTEGRITY` is still meaningful; `MEETS_DEVICE_INTEGRITY` is close to free for an attacker.**

**Operational catch the plan doesn't mention:** default quota is **10,000 token requests/day and 10,000 server-side decryptions/day** per Cloud project, with increases requiring a Play-listed app and a request form that can take a week ([setup](https://developer.android.com/google/play/integrity/setup)). At scale that is a capacity planning item, not a checkbox.

**Verdict:** keep it as the escape hatch, but rewrite the expectation. If we pull this trigger, the gate must be **`MEETS_STRONG_INTEGRITY` only** (accepting rejection of older/unpatched devices), the web payload must be **bundled in the APK, not loaded from `server.url`**, and it must be treated as **one signal among many**, not a recovered trust boundary. It hardens device provenance. It does not make our JavaScript trustworthy — nothing does.

---

## 10. What this adds up to

**The attacker's bill for 500 accounts**, assembled from the prices sourced above. Every figure is vendor-published, i.e. an upper bound on their cost.

| Line item | Cost |
|---|---|
| 500 passkeys (software / CDP virtual authenticator) | **$0** |
| Anti-detect browser, 60–100 profiles | **$10–89 / month** |
| Residential proxies, 500 light profiles | **$5–30** |
| ~2,000 Turnstile solves | **$2.40–2.90** |
| 500 phone verifications via +62 OTP rental | **$5–50** |
| **Total to stand up and run 500 accounts** | **under $150, mostly one-off** |

Against voucher-scale rewards, **every control in `08` §2.1 above the "Behavioural" row is ROI-positive for the attacker**. That is the honest position. It does not make web the wrong call — it makes the *placement* of the defences wrong.

**All the failed controls fail the same way:** they are pre-authentication, per-session checks against a post-authentication, cross-account, longitudinal problem. The plan spent its defence budget at the front door.

### Changes this forces on `08`

| Row in `08` §2.1 | Change |
|---|---|
| **Server truth** — CDN segment cross-check | **Delete.** Replace with a nonce-chained, non-replayable heartbeat bound to the checkpoint questions (§1 option B). Put self-hosted HLS on R2 (§1 option A) on the roadmap as the *first* hardening trigger — it is cheaper than Stream at scale *and* produces the evidence. |
| **Identity anchor** — SIM/NIK | **Demote** from "best single control" to "deduplication key + nuisance tax". Add line-type/VoIP screening at signup and again at first payout. |
| **Device binding** — passkey | **Re-file under account security.** It is not a farm control. |
| **Bot gate** — Turnstile | Keep; drop the "raises per-account cost" rationale; Interactive mode on reward claim. |
| **Fingerprint** | Keep, weighted exactly as the plan says. High-precision when it fires, zero information when it doesn't. |
| *(new)* **Payout-instrument uniqueness** | **This becomes the identity anchor.** One verified e-wallet/bank destination per account, one account per destination, enforced at redemption. In Indonesia the KYC'd PJP e-wallet is the genuinely scarce, expensive-to-replicate resource — not the SIM. |
| *(new)* **Time as cost** | Holdback and reduced earn rate for untrusted tiers now carry materially more load. 72 h is the floor, not the target. Vesting converts the attacker's one-off capital cost into holding cost and buys the graph time to fire. |

**Also update `08` §2.2:** the Capacitor trigger must add **Stream delivery spend** to its threshold (a segment-scraping farm burns $0.03 per video-length at full rate regardless of payout), and the gate on the far side must be `MEETS_STRONG_INTEGRITY` with the web payload bundled in the APK.

### Open spikes

| Spike | Test | Days |
|---|---|---|
| Stream analytics resolution | §1 above — watched vs `curl`-scraped session, hourly GraphQL polling for 24 h. Can *any* dimension tell them apart? | 2 |
| R2+Worker HLS viability | Transcode one 30-min asset, serve signed per-session segments, confirm R2 Data Access Logs + Workers Logpush actually yield per-segment records with usable latency (docs say *"asynchronous and best effort … may be delayed or omitted"* — verify) | 5 |
| iOS wake-lock reality | Real iPhone matrix (16.4 tab, <18.4 PWA, 18.4+ PWA, Low Power Mode) — measure actual `NotAllowedError` rate in the field before relying on it | 2 |
| Indonesian OTP-rental block rate | Buy 20 numbers from two rental services, run them through Twilio Lookup / Telesign. What fraction is correctly flagged as non-mobile or high-risk? **Unverified — this number decides whether phone verification is worth its friction at all.** | 3 |
