#!/usr/bin/env node
// 14.6.a: time to first frame on Shorts, on the Lighthouse mobile profile in lighthouserc.cjs
// (360x640 at DPR 2.625, 4x CPU, 170 ms RTT, 9 Mbps both ways), applied through the DevTools protocol.
//
//   YT_VIEWER_EMAIL=... YT_VIEWER_PASSWORD=... \
//     node apps/web/scripts/first-frame.mjs https://yourtal.gaiada.com [--runs 9] [--path /shorts]
//       [--auth signed-in|signed-out|both] [--warm] [--fresh] [--trace out.json] [--headed] [--chrome-path <exe>]
//       [--insecure]
//
// For a local stand-in server, YT_SESSION_TOKEN (a yt_session value) replaces the sign-in, and
// --insecure accepts its self-signed certificate.
//
// --fresh starts a new browser process for every run (a run then cannot slow the next); FF_CPU overrides the CPU
// throttle (1 for the unthrottled cost of a main-thread task). The pSent / pEnd columns are when the poster request
// was sent and its last byte arrived (blank for a cross-origin poster, which the browser does not time).
//
// "Poster painted" is the largest-contentful-paint entry for the first Short's poster (13.4.a's
// definition); "video frame" is the first requestVideoFrameCallback of the first <video>. Each run
// uses a fresh browser context (cold HTTP cache, no service worker) unless --warm, which loads the
// page once first in the same context. The viewer's credentials come from the environment only.
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const has = (name) => args.includes(`--${name}`);
const base = args.find((a) => /^https?:\/\//.test(a));
if (!base) {
  console.error(
    "usage: first-frame.mjs <base-url> [--runs 9] [--path /shorts] [--auth signed-in|signed-out|both]",
  );
  process.exit(2);
}
const runs = Number(flag("runs", "9"));
const route = flag("path", "/shorts");
const authMode = flag("auth", "signed-in");
const tracePath = flag("trace", undefined);
const waitMs = Number(flag("timeout", "20000"));

// lighthouserc.cjs, field for field.
const PROFILE = {
  width: 360,
  height: 640,
  dpr: 2.625,
  cpu: Number(process.env.FF_CPU ?? 4),
  rttMs: 170,
  kbps: 9000,
};
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

// Runs before any page script. Records paints and the first Short's poster and video frame.
function probe() {
  const state = (window.__ff = { lcp: [], paint: {}, poster: null, frame: null, posterUrl: null });
  // The first Short's poster: the video's own `poster`, or (14.6.b) the <img> laid over it,
  // where the browser picks one candidate of its srcset.
  const posterUrls = () => {
    const v = document.querySelector("video");
    if (!v) return [];
    const own = v.getAttribute("poster");
    if (own) return [new URL(own, location.href).href];
    const img = v.parentElement?.querySelector("img");
    if (!img) return [];
    const set = (img.getAttribute("srcset") ?? "")
      .split(",")
      .map((c) => c.trim().split(/\s+/)[0])
      .filter(Boolean);
    return [img.src, img.currentSrc, ...set]
      .filter(Boolean)
      .map((u) => new URL(u, location.href).href);
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      state.lcp.push({
        t: e.renderTime || e.loadTime,
        url: e.url,
        tag: e.element?.tagName ?? null,
      });
      if (state.poster === null && e.url && posterUrls().includes(e.url)) {
        state.poster = e.renderTime || e.loadTime;
        state.posterUrl = e.url;
      }
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) state.paint[e.name] = e.startTime;
  }).observe({ type: "paint", buffered: true });
  const watch = () => {
    const v = document.querySelector("video");
    if (!v) return false;
    if ("requestVideoFrameCallback" in v)
      v.requestVideoFrameCallback(() => (state.frame ??= performance.now()));
    else
      v.addEventListener("loadeddata", () => (state.frame ??= performance.now()), { once: true });
    return true;
  };
  if (!watch()) {
    const mo = new MutationObserver(() => watch() && mo.disconnect());
    mo.observe(document, { childList: true, subtree: true });
  }
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ms = (x) => (typeof x === "number" ? `${Math.round(x)}`.padStart(6) : "     -");

const launch = () =>
  chromium.launch({
    headless: !has("headed"),
    ...(has("chrome-path") ? { executablePath: flag("chrome-path") } : { channel: "chrome" }),
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
let browser = await launch();
const contextOptions = {
  viewport: { width: PROFILE.width, height: PROFILE.height },
  deviceScaleFactor: PROFILE.dpr,
  isMobile: true,
  hasTouch: true,
  userAgent: MOBILE_UA,
  baseURL: base,
  ignoreHTTPSErrors: has("insecure"),
};

async function signIn() {
  if (process.env.YT_SESSION_TOKEN) {
    const url = new URL(base);
    const cookie = (name, value) => ({
      name,
      value,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    });
    return {
      origins: [],
      cookies: [
        cookie("yt_session", process.env.YT_SESSION_TOKEN),
        cookie("yt_region", "AU"),
        cookie("yt_locale", "en-AU"),
      ],
    };
  }
  const email = process.env.YT_VIEWER_EMAIL;
  const password = process.env.YT_VIEWER_PASSWORD;
  if (!email || !password)
    throw new Error("set YT_VIEWER_EMAIL and YT_VIEWER_PASSWORD (or pass --auth signed-out)");
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(home|onboarding)/, { timeout: 30_000 });
  const state = await context.storageState();
  await context.close();
  return state;
}

async function throttled(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpu });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: PROFILE.rttMs,
    downloadThroughput: (PROFILE.kbps * 1000) / 8,
    uploadThroughput: (PROFILE.kbps * 1000) / 8,
  });
  return cdp;
}

async function oneRun(storageState, { trace, warm }) {
  const context = await browser.newContext({
    ...contextOptions,
    ...(storageState ? { storageState } : {}),
  });
  await context.addInitScript(probe);
  const page = await context.newPage();
  await throttled(page);
  if (warm) {
    await page.goto(route, { waitUntil: "load" });
    await page.waitForTimeout(1500);
  }
  if (trace)
    await browser.startTracing(page, {
      categories: [
        "devtools.timeline",
        "blink.user_timing",
        "loading",
        "v8",
        "disabled-by-default-devtools.timeline",
      ],
    });
  await page.goto(route, { waitUntil: "commit" });
  await page
    .waitForFunction(() => window.__ff?.poster != null && window.__ff?.frame != null, null, {
      timeout: waitMs,
    })
    .catch(() => {});
  const result = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource");
    return {
      poster: window.__ff.poster,
      frame: window.__ff.frame,
      fcp: window.__ff.paint["first-contentful-paint"] ?? null,
      fp: window.__ff.paint["first-paint"] ?? null,
      responseEnd: nav.responseEnd,
      dcl: nav.domContentLoadedEventEnd,
      posterUrl: window.__ff.posterUrl,
      // The poster request's own timing: when it was sent and when its last byte arrived.
      posterSent: res.find((r) => r.name === window.__ff.posterUrl)?.requestStart ?? null,
      posterEnd: res.find((r) => r.name === window.__ff.posterUrl)?.responseEnd ?? null,
      items: document.querySelectorAll("video").length,
      jsKb: Math.round(
        res.filter((r) => r.name.endsWith(".js")).reduce((n, r) => n + r.encodedBodySize, 0) / 1024,
      ),
      cssKb: Math.round(
        res.filter((r) => r.name.endsWith(".css")).reduce((n, r) => n + r.encodedBodySize, 0) /
          1024,
      ),
    };
  });
  if (trace) writeFileSync(trace, await browser.stopTracing());
  await context.close();
  return result;
}

const modes = authMode === "both" ? ["signed-out", "signed-in"] : [authMode];
const storageState = modes.includes("signed-in") ? await signIn() : undefined;
let failed = false;
for (const mode of modes) {
  console.log(
    `\n${base}${route}  ${mode}  ${runs} runs${has("warm") ? ", warm" : ", cold context"}  (360x640 @2.625, 4x CPU, 170 ms RTT, 9 Mbps)`,
  );
  console.log(
    "  run  poster  frame     fcp      fp     dcl  respEnd  jsKB cssKB videos  pSent  pEnd",
  );
  const rows = [];
  for (let i = 0; i < runs; i += 1) {
    // --fresh: a new browser process per run, so one run's leftovers cannot slow the next.
    if (has("fresh") && i > 0) {
      await browser.close();
      browser = await launch();
    }
    const r = await oneRun(mode === "signed-in" ? storageState : undefined, {
      trace: i === 0 && tracePath ? tracePath : null,
      warm: has("warm"),
    });
    rows.push(r);
    console.log(
      `  ${String(i + 1).padStart(3)} ${ms(r.poster)} ${ms(r.frame)} ${ms(r.fcp)} ${ms(r.fp)} ${ms(r.dcl)} ${ms(r.responseEnd)} ${String(r.jsKb).padStart(5)} ${String(r.cssKb).padStart(5)} ${String(r.items).padStart(5)} ${ms(r.posterSent)} ${ms(r.posterEnd)}`,
    );
  }
  const col = (k) => rows.map((r) => r[k]);
  const missing = rows.filter((r) => r.poster == null).length;
  console.log(
    `  median ${ms(median(col("poster")))} ${ms(median(col("frame")))} ${ms(median(col("fcp")))} ${ms(median(col("fp")))} ${ms(median(col("dcl")))} ${ms(median(col("responseEnd")))}`,
  );
  const under = col("poster").filter((x) => typeof x === "number" && x <= 1000).length;
  console.log(
    `  poster painted <= 1000 ms in ${under} of ${rows.length} runs${missing ? `; no poster seen in ${missing} runs (empty feed or signed-out error state)` : ""}`,
  );
  const med = median(col("poster"));
  if (med === null || med > 1000) failed = true;
}
await browser.close();
process.exit(failed && has("assert") ? 1 : 0);
