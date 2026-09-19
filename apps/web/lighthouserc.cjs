// YT-0404 — Performance budget harness.
//
// Runs against a production build (`next build` + `next start`), not `next
// dev` — dev builds are unminified and unrepresentative of what ships.
//
// ---------------------------------------------------------------------------
// THROTTLING: "mid-tier Android over 4G" — the actual numbers, and why.
// ---------------------------------------------------------------------------
// docs/08-web-app-and-performance.md §3 names the target device explicitly:
// "a mid-tier Android phone on 4G in Jakarta — roughly a 4x CPU slowdown
// against a desktop and highly variable RTT." Lighthouse's built-in `mobile`
// preset throttling is NOT used as-is here — we set every field explicitly
// so the profile is legible and defensible on its own, not inherited from
// whatever Lighthouse's defaults happen to be this release.
//
// Network — WebPageTest's well-known "4G" connectivity profile (170ms RTT,
// 9 Mbps down, 9 Mbps up). This is deliberately "typical 4G", not "Slow 4G"
// (~400ms RTT / 400 Kbps, which is closer to a 3G fallback) and not a
// best-case unthrottled 4G. Jakarta 4G RTT is "highly variable" per the doc,
// so we anchor to the well-documented mid-point rather than inventing a
// number:
//   rttMs: 170
//   throughputKbps: 9000       (down)
//   uploadThroughputKbps: 9000
//
// CPU — cpuSlowdownMultiplier: 4. This is the same multiplier Lighthouse has
// used for years to approximate a Moto G4-class device against typical CI/
// lab hardware. A modern mid-tier Android (e.g. a Snapdragon 6-series phone)
// is faster than a 2016 Moto G4 in absolute terms, but CI runner CPUs have
// also gotten faster over the same period, and independent benchmarking
// (WebPageTest, web.dev's own device-to-desktop ratio writeups) has kept
// landing back around the same ~4x ratio between "mid-tier mobile" and
// "typical test hardware" release after release. We are not claiming 4x is
// derived from a fresh benchmark of a specific 2026 device — we are
// deliberately choosing the well-established, widely-cross-checked number
// over inventing a bespoke one that nobody could sanity-check later.
// If a future device audit shows the actual ratio has drifted, change this
// number and this comment together.
//
// Viewport/DPR — screenEmulation matches Lighthouse's own moto-g4 mobile
// emulation profile (360x640 CSS px, DPR 2.625), which agrees with
// formFactor: 'mobile' below — we never mix a mobile viewport with desktop
// throttling or vice versa, because that combination measures a device that
// doesn't exist.
// ---------------------------------------------------------------------------
// INP vs TBT — read this before changing the perf-inp-proxy assertion.
// ---------------------------------------------------------------------------
// INP (Interaction to Next Paint) is a FIELD metric: it requires a real user
// interaction with real input latency, and Lighthouse — a lab tool driving a
// scripted page load with no user in the loop — cannot produce one. Any
// config that claims to "assert INP" in a Lighthouse CI run is lying about
// what it measured. We do not do that here.
//
// What we assert instead is Total Blocking Time (TBT), Lighthouse's
// documented lab proxy for responsiveness. TBT sums the "blocked" portion of
// every long task between First Contentful Paint and Time to Interactive —
// it approximates "how unresponsive is the main thread while this page is
// loading", which correlates with, but is not, INP. A TBT budget of 200ms is
// used here as the threshold that keeps this app's lab responsiveness in the
// range field INP ≤ 200ms is achievable from — not as a claim that TBT 200ms
// *is* INP 200ms. Real INP must come from field RUM (see
// docs/08-web-app-and-performance.md §3.1: "real-user monitoring (RUM),
// segmented by country, connection type and device class"), which is a
// separate, not-yet-built piece of work — see the ticket report.
// ---------------------------------------------------------------------------
// Initial JS (>170 KB gz) is NOT asserted here at all. Lighthouse's
// `total-byte-weight` measures total page weight (images, fonts, third
// -party) which is a different, adjacent thing to "first-load JS for the
// route". That budget is enforced at build time against Next's own output —
// see scripts/perf-check-bundle-size.mjs — because that is the accurate
// measurement, and a build-time gate can't be fooled by a fast connection
// making an audit pass.
// ---------------------------------------------------------------------------

const PORT = 4173;

/** @type {import('@lhci/utils/src/types').LHCI.RcFile} */
module.exports = {
  ci: {
    collect: {
      // Boots the already-built app; the workflow runs `next build` first.
      startServerCommand: `pnpm --filter @yourtal/web exec next start -p ${PORT}`,
      startServerReadyPattern: "Ready in",
      startServerReadyTimeoutMs: 30_000,
      url: [`http://localhost:${PORT}/`],
      numberOfRuns: 3,
      settings: {
        // Explicit rather than relying on lhci's CI auto-detection —
        // GitHub Actions' ubuntu-latest runners need --no-sandbox.
        chromeFlags: ["--no-sandbox", "--headless=new"],
        formFactor: "mobile",
        screenEmulation: {
          mobile: true,
          width: 360,
          height: 640,
          deviceScaleFactor: 2.625,
          disabled: false,
        },
        throttlingMethod: "simulate",
        throttling: {
          rttMs: 170,
          throughputKbps: 9000,
          requestLatencyMs: 170 * 3.75, // lantern's simulate multiplier convention
          downloadThroughputKbps: 9000,
          uploadThroughputKbps: 9000,
          cpuSlowdownMultiplier: 4,
        },
        onlyCategories: ["performance"],
      },
    },
    assert: {
      assertions: {
        // LCP ≤ 2.0s — hard fail per docs/08 §3.1 (budget, not the 2.5s
        // "hard fail" ceiling mentioned as an upper bound in that doc; we
        // gate at the budget itself, not the looser fallback).
        "largest-contentful-paint": ["error", { maxNumericValue: 2000 }],
        // CLS ≤ 0.1
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        // INP lab proxy — see the long comment above. NOT a real INP
        // measurement; asserted here because Lighthouse cannot produce one.
        "total-blocking-time": ["error", { maxNumericValue: 200 }],
        // TTFB budget from docs/08 §3.1 (600ms, in-region edge). Included as
        // a warning, not a hard gate, since edge routing isn't wired up yet
        // against this placeholder scaffold (YT-0402 dependency, see ticket
        // report) and a warning is honest about that; tighten to "error"
        // once the app is served from its real edge deployment.
        "server-response-time": ["warn", { maxNumericValue: 600 }],
      },
    },
    upload: {
      // No LHCI server stood up yet; temporary-public-storage gives every
      // PR run a shareable report link without provisioning infrastructure
      // for a ticket that's explicitly starting ahead of its dependency.
      target: "temporary-public-storage",
    },
  },
};
