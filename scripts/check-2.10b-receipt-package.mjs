#!/usr/bin/env node
// 2.10.b T9 (docs/27-receipt-packages.md section 5): the receipt package on
// staging, against the payment simulation, with evidence. SnapApp's receipt
// points are paid from a package its funder bought at cost, not from marketing.
// Standalone: `fetch` only, no workspace imports, so a copy runs on Helios. No
// password, cookie, key, signing secret or card number is ever printed.
//
//   node --env-file=/opt/yourtal/secrets/app.env check-2.10b-receipt-package.mjs <command> [flags]
//
// Commands:
//   phase-a   Run FIRST, with the switch (T2b) off. Reads receipt_funder.snap-app (AU, ID) in the
//             staff settings, the funder's three at-cost tiers, the 404 for a non-funder and the
//             403 for a marketer, then buys the AU Starter (and the ID Starter) with programme
//             "receipts" and 4242, and checks the purchase, the allocation, the at-cost amount
//             and the invoice line. Skips a purchase when the funder already has a receipt
//             package in that region (NOTE), unless --force.
//   phase-b   Run AFTER T2b and T4 are deployed, while staging is quiet. Partner status read,
//             buys a fresh AU Starter (the subject). Then the drain: receipt_points 100 (two
//             finance staff); filler users (E, F) use older packages up to under 100 left; A sends
//             5, B 3 + 2 receipts to the subject (50%, 80%, 100% alerts, once each, in Studio and the dev inbox),
//             a third user (C) is refused (409 allocation_exhausted, status earning:false), replays,
//             then receipt_points back, a second Starter, and a new receipt earns again.
//             Needs --yes. Takes about 15 minutes (alerts run every 2 minutes).
//   restore   Puts receipt_points for AU back (to the value phase-b noted, else 1) after an
//             interrupted phase-b.
//
// Flags: --force (buy even if a receipt package exists), --yes (start the drain).
//
// Env: STAGING_DEMO_PASSWORD (required), STAGING_REVIEW_PASSWORD (non-staff logins when set),
// STRIPE_SECRET_KEY (the simulation's key, for independent evidence), STRIPE_API_BASE
// (default <api>/api/paysim), PAYSIM_PAGES_BASE_URL (default <api>/api/paysim),
// DEMO_API_BASE_URL (default http://127.0.0.1:26301), SNAP_APP_PARTNER_SECRET (phase-b; the env
// var the partner row names, override the name with CHECK_PARTNER_SECRET_ENV),
// CHECK_PARTNER_ID (default snap-app), CHECK_FINANCE2_EMAIL (the second finance member for the
// two-person rule, default ops@demo.yourtal.test; it must hold the finance role: on the box run
// `pnpm staff:add <email> finance` first), CHECK_RECEIPT_USERS (A,B,C demo local parts, default
// adult,guardian,member), CHECK_FILLER_USERS (default charity2,viewer; at most 5 grants each), CHECK_INVOICE_WAIT_MIN (default 8), CHECK_ALERT_WAIT_MIN (per alert,
// default 4), CHECK_SETTINGS_WAIT_SEC (after a setting is approved, default 75),
// CHECK_STATE_FILE (default in the temp directory).
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = (process.env.DEMO_API_BASE_URL ?? "http://127.0.0.1:26301").replace(/\/+$/, "");
const PASSWORD = process.env.STAGING_DEMO_PASSWORD;
const REVIEW_PASSWORD = process.env.STAGING_REVIEW_PASSWORD || PASSWORD;
const SIM_KEY = process.env.STRIPE_SECRET_KEY;
const SIM_API = (process.env.STRIPE_API_BASE ?? `${API}/api/paysim`).replace(/\/+$/, "");
const PAGES = (process.env.PAYSIM_PAGES_BASE_URL ?? `${API}/api/paysim`).replace(/\/+$/, "");
const PARTNER_ID = process.env.CHECK_PARTNER_ID ?? "snap-app";
const PARTNER_SECRET =
  process.env[process.env.CHECK_PARTNER_SECRET_ENV ?? "SNAP_APP_PARTNER_SECRET"];
const FINANCE2 = (process.env.CHECK_FINANCE2_EMAIL ?? "ops@demo.yourtal.test").toLowerCase();
const [USER_A, USER_B, USER_C] = (process.env.CHECK_RECEIPT_USERS ?? "adult,guardian,member")
  .split(",")
  .map((s) => s.trim());
// Filler users drain older packages (5 grants each at most: the risk gate blocks at 10 in 10 min).
const FILLER_USERS = (process.env.CHECK_FILLER_USERS ?? "charity2,viewer")
  .split(",")
  .map((x) => x.trim());
const INVOICE_WAIT_MS = Number(process.env.CHECK_INVOICE_WAIT_MIN ?? 8) * 60_000;
const ALERT_WAIT_MS = Number(process.env.CHECK_ALERT_WAIT_MIN ?? 4) * 60_000;
const SETTINGS_WAIT_MS = Number(process.env.CHECK_SETTINGS_WAIT_SEC ?? 75) * 1000;
const STATE_FILE = process.env.CHECK_STATE_FILE ?? join(tmpdir(), "check-2.10b-state.json");
if (!PASSWORD) throw new Error("needs STAGING_DEMO_PASSWORD");

const CARD_OK = "4242 4242 4242 4242";
const RUN = randomUUID().slice(0, 8);
const DEMO_DOMAIN = "demo.yourtal.test";
// The staging seed's receipt funders (packages/db/src/seed/staging.ts SNAP_APP_AU_ID, SNAP_APP_ID_ID).
const FUNDERS = {
  AU: {
    biz: "00000000-0000-4000-9000-000000000001",
    ownerEmail: `owner.au@${DEMO_DOMAIN}`,
    currency: "AUD",
  },
  ID: {
    biz: "00000000-0000-4000-9000-000000000002",
    ownerEmail: `owner.id@${DEMO_DOMAIN}`,
    currency: "IDR",
  },
};
// docs/27 section 1: a tier is its size at exactly B (no discount). B is not visible to staff or
// businesses (F54), so prices are checked for shape, not pinned.
const TAX_BPS = { AU: 1_000, ID: 0 };
const halfUpTax = (subtotal, bps) => Math.floor((subtotal * bps + 5_000) / 10_000);
const TIER_POINTS = { starter: 1_000, grow: 10_000, scale: 50_000 };
const RECEIPT_WORDING = "YourTal points for receipt rewards";
const PAUSED_MESSAGE = "receipt points are paused: the receipt package is used up";
const FLAGS = new Set(process.argv.slice(3).filter((a) => a.startsWith("--")));

// ---------------------------------------------------------------- output

const SECRETS = [PASSWORD, REVIEW_PASSWORD, SIM_KEY, PARTNER_SECRET].filter(
  (s) => s && s.length >= 6,
);
function scrub(text) {
  let out = String(text);
  for (const secret of SECRETS) out = out.split(secret).join("<redacted>");
  return out;
}
const say = (line) => console.log(scrub(line));
let failures = 0;
const pass = (what, detail = "") => say(`PASS  ${what}${detail ? ` -- ${detail}` : ""}`);
const note = (what, detail = "") => say(`NOTE  ${what}${detail ? ` -- ${detail}` : ""}`);
function fail(what, detail = "") {
  failures += 1;
  say(`FAIL  ${what}${detail ? ` -- ${detail}` : ""}`);
}
function expect(cond, what, detail = "") {
  if (cond) pass(what, detail);
  else fail(what, detail);
  return Boolean(cond);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (v) => JSON.stringify(v)?.slice(0, 300);

async function until(fn, timeoutMs, everyMs = 3_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= end) return null;
    await sleep(everyMs);
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveState(patch) {
  writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }));
}

// ---------------------------------------------------------------- the API

async function call(method, path, session, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(session ? { cookie: session.cookie } : {}),
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "idempotency-key": randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: the raw text is the useful part
  }
  return { status: res.status, body: json };
}

const isStaff = (email) => /^[a-z-]+@demo\.yourtal\.test$/.test(email);
const sessions = new Map();
async function login(email) {
  if (sessions.has(email)) return sessions.get(email);
  const password = isStaff(email) ? PASSWORD : REVIEW_PASSWORD;
  for (;;) {
    const res = await call("POST", "/api/auth/login", undefined, { email, password });
    if (res.status === 429) {
      const wait = res.body?.retryAfterSeconds ?? 60;
      note("login is rate-limited", `waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status >= 400) throw new Error(`login ${email}: HTTP ${res.status}`);
    const session = { cookie: `yt_session=${res.body.token}`, userId: res.body.userId, email };
    sessions.set(email, session);
    return session;
  }
}
const demo = (who, region = "au") => `${who}.${region}@${DEMO_DOMAIN}`;
const staff = (who) => `${who}@${DEMO_DOMAIN}`;

async function ok(res, what) {
  if (res.status >= 400) throw new Error(`${what}: HTTP ${res.status} ${short(res.body)}`);
  return res.body;
}

/**
 * A signed partner call, the way SnapApp makes it: the body is serialised once, its exact bytes are
 * signed (HMAC-SHA256, hex) and sent. 429s wait and retry with the same key and bytes.
 */
async function partner(path, body, { key = randomUUID() } = {}) {
  if (!PARTNER_SECRET)
    throw new Error(
      "needs SNAP_APP_PARTNER_SECRET (or CHECK_PARTNER_SECRET_ENV) in the environment",
    );
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", PARTNER_SECRET).update(raw, "utf8").digest("hex");
  for (;;) {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        authorization: `Partner ${PARTNER_ID}:${signature}`,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: raw,
    });
    const text = await res.text();
    let json = text;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // keep the raw text
    }
    if (res.status === 429) {
      const wait = json?.retryAfterSeconds ?? 30;
      note("partner call rate-limited", `waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    return { status: res.status, body: json };
  }
}

// ------------------------------------------------- the simulation's own API

async function sim(path) {
  if (!SIM_KEY)
    throw new Error("needs STRIPE_SECRET_KEY (the simulation's key) in the environment");
  const res = await fetch(`${SIM_API}${path}`, { headers: { authorization: `Bearer ${SIM_KEY}` } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // leave null
  }
  return { status: res.status, body };
}
function pageUrl(url) {
  const u = new URL(url);
  const at = u.pathname.search(/\/(checkout|connect)\//);
  if (at < 0) throw new Error(`not a simulation page: ${u.pathname}`);
  return `${PAGES}${u.pathname.slice(at)}${u.search}`;
}
async function csrfOf(url) {
  const page = await fetch(url, { redirect: "manual" });
  const html = await page.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  if (page.status !== 200 || !csrf)
    throw new Error(`page ${new URL(url).pathname}: HTTP ${page.status}, no form`);
  return csrf;
}
async function submitCard(checkoutUrl, number) {
  const url = pageUrl(checkoutUrl);
  const res = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrf: await csrfOf(url),
      number,
      expiry: "12 / 34",
      cvc: "123",
    }).toString(),
  });
  return { status: res.status, location: res.headers.get("location"), html: await res.text() };
}

// ----------------------------------------------------------- shared reads

/**
 * A tier's at-cost [subtotal, tax] as the funder's programme read shows it. B is never exposed
 * (F54), so prices are not derived: the purchase, checkout and simulation must equal this read.
 */
async function programmeTier(region, tier) {
  const { biz } = FUNDERS[region];
  const view = await ok(await programmeOf(await funderOwner(region), biz), `${region} programme`);
  const p = view.packages.find((x) => x.tierKey === tier);
  if (!p) throw new Error(`${region}: the receipt programme has no ${tier} tier`);
  return [p.subtotalMinor, p.taxMinor];
}
const billing = (biz) => `/api/${biz}/studio/billing`;

/** The funder's owner, checked to be a member of the funder business. */
async function funderOwner(region) {
  const { biz, ownerEmail } = FUNDERS[region];
  const owner = await login(ownerEmail);
  const mine = await ok(await call("GET", "/api/me/businesses", owner), "my businesses");
  if (!mine.some((m) => m.business?.id === biz))
    throw new Error(`${ownerEmail} is not a member of ${biz}: run the staging seed or demo reset`);
  return owner;
}
const programmeOf = async (owner, biz) => call("GET", `${billing(biz)}/receipt-programme`, owner);
const balanceOf = async (owner, biz) =>
  ok(await call("GET", `${billing(biz)}/balance`, owner), "balance");
const receiptPackages = (balance) => balance.allocations.filter((a) => a.programme === "receipts");

async function stableUser(who) {
  return login(demo(who));
}

/** Staff economy settings for a region: the approved rows. */
async function staffSettings(region) {
  const finance = await login(staff("finance"));
  const screen = await ok(
    await call("GET", `/api/staff/economy/${region}/settings`, finance),
    `${region} settings`,
  );
  return screen.current;
}

// ---------------------------------------------------------- invoices

/** Waits for the invoices the purchases should produce; checks the receipt wording and the sums. */
const invoiceWatch = [];
async function checkInvoices() {
  const todo = invoiceWatch.splice(0);
  if (todo.length === 0) return;
  say(`-- invoices: waiting up to ${INVOICE_WAIT_MS / 60_000} min for the invoice job --`);
  const claimed = new Set();
  const found = new Map();
  const end = Date.now() + INVOICE_WAIT_MS;
  for (;;) {
    for (const spec of todo) {
      if (found.has(spec)) continue;
      const list = await ok(
        await call("GET", `/api/${spec.biz}/studio/invoices`, spec.owner),
        "invoices",
      );
      const hit = list.invoices.find(
        (i) =>
          !claimed.has(i.id) &&
          i.totalMinor === spec.total &&
          i.lines.some((l) => l.description.includes(RECEIPT_WORDING)) &&
          (i.paymentRef
            ? [spec.piId, spec.sessionId].includes(i.paymentRef)
            : new Date(i.issuedAt) >= spec.startedAt),
      );
      if (hit) {
        claimed.add(hit.id);
        found.set(spec, hit);
      }
    }
    if (found.size === todo.length || Date.now() >= end) break;
    await sleep(15_000);
  }
  for (const spec of todo) {
    const inv = found.get(spec);
    if (!inv) {
      fail(
        `invoice for ${spec.label}`,
        `none with a "${RECEIPT_WORDING}" line after ${INVOICE_WAIT_MS / 60_000} min (is the worker's invoice.issue job running, the AU invoice_issuer setting approved, and 2.10.b T5's invoice source deployed?)`,
      );
      continue;
    }
    const lines = inv.lines.reduce((s, l) => [s[0] + l.subtotalMinor, s[1] + l.taxMinor], [0, 0]);
    expect(
      inv.subtotalMinor + inv.taxMinor === inv.totalMinor &&
        lines[0] === inv.subtotalMinor &&
        lines[1] === inv.taxMinor,
      `invoice ${inv.number} adds up for ${spec.label}`,
      `id ${inv.id}, subtotal ${inv.subtotalMinor} + GST ${inv.taxMinor} = ${inv.totalMinor} ${inv.currency}`,
    );
    const line = inv.lines.find((l) => l.description.includes(RECEIPT_WORDING));
    expect(
      line?.description === `1,000 ${RECEIPT_WORDING}`,
      "the invoice line reads as a receipt package",
      `"${line?.description}"`,
    );
    const other = await call(
      "GET",
      `/api/${FUNDERS.ID.biz}/studio/invoices/${inv.id}/pdf`,
      spec.owner,
    );
    expect(
      other.status === 403 || other.status === 404,
      `another business's tenant path does not serve invoice ${inv.number}`,
      `HTTP ${other.status}`,
    );
  }
}

// ------------------------------------------------------ buying a package

/**
 * Buys the Starter receipt package for `region` through the real routes and the simulated
 * checkout (the way check-5.1.f's purchase step does), and checks every hop. Returns the new
 * allocation id, or null when nothing was bought.
 */
async function buyReceiptStarter(region, { force }) {
  const { biz, currency } = FUNDERS[region];
  const owner = await funderOwner(region);
  const [subtotal, tax] = await programmeTier(region, "starter");
  const before = await balanceOf(owner, biz);
  const existing = receiptPackages(before);
  if (existing.length > 0 && !force) {
    note(
      `${region}: a receipt package already exists, not buying another`,
      `${existing.length} package(s), ${existing.reduce((s, a) => s + a.remainingPoints, 0)} points left; re-run with --force to buy one more`,
    );
    for (const a of existing) {
      expect(
        a.programme === "receipts" && a.funderType === "partner",
        `${region}: allocation ${a.allocationId} is a receipt package`,
        `${a.totalPoints} total, ${a.remainingPoints} left`,
      );
    }
    return null;
  }
  const startedAt = new Date();
  const started = await ok(
    await call("POST", `${billing(biz)}/purchases`, owner, {
      tierKey: "starter",
      currency,
      programme: "receipts",
    }),
    `${region} start receipt purchase`,
  );
  const sessionId = /\/checkout\/([^/?#]+)/.exec(started.checkoutUrl ?? "")?.[1];
  // AU pays through the simulated checkout page. ID is a demo with no real money (F104): the
  // purchase comes back paid at once, with no checkout URL.
  const paidAtOnce = started.status === "paid";
  if (
    !expect(
      (paidAtOnce || (started.status === "awaiting_payment" && sessionId)) &&
        started.purchase.programme === "receipts" &&
        started.purchase.currency === currency &&
        started.purchase.subtotalMinor === subtotal &&
        started.purchase.taxMinor === tax &&
        started.purchase.totalMinor === subtotal + tax,
      `${region}: the receipt purchase is for the at-cost total`,
      `purchase ${started.purchaseId}, ${started.status}, ${started.purchase?.subtotalMinor} + ${started.purchase?.taxMinor} = ${started.purchase?.totalMinor} ${started.purchase?.currency}, programme ${started.purchase?.programme}`,
    )
  )
    return null;

  const poll = async () =>
    ok(await call("GET", `${billing(biz)}/purchases/${started.purchaseId}`, owner), "purchase");
  let piId = null;
  if (!paidAtOnce) {
    const submitted = await submitCard(started.checkoutUrl, CARD_OK);
    piId = (await sim(`/v1/checkout/sessions/${sessionId}`)).body?.payment_intent ?? null;
    expect(
      submitted.status === 303 && (submitted.location ?? "").includes(started.purchaseId),
      `${region}: 4242 is accepted and returns to Studio`,
      `HTTP ${submitted.status}`,
    );
  }
  const paid = await until(
    async () => {
      const row = await poll();
      return row.status === "paid" ? row : null;
    },
    paidAtOnce ? 30_000 : 120_000,
    2_000,
  );
  if (
    !expect(
      paid?.allocationId,
      `${region}: the purchase is paid and has an allocation`,
      `purchase ${started.purchaseId}, allocation ${paid?.allocationId}`,
    )
  )
    return null;
  expect(
    paid.programme === "receipts" && paid.subtotalMinor === subtotal && paid.points === 1_000,
    `${region}: the paid purchase carries programme receipts and the at-cost amount`,
    `${paid.subtotalMinor} ex-tax for ${paid.points} points (the programme read said ${subtotal})`,
  );
  const after = await balanceOf(owner, biz);
  const allocation = after.allocations.find((a) => a.allocationId === paid.allocationId);
  expect(
    allocation?.programme === "receipts" &&
      allocation.totalPoints === 1_000 &&
      allocation.remainingPoints === 1_000 &&
      allocation.funderType === "partner",
    `${region}: the allocation is a receipt package with 1,000 points left`,
    short(allocation),
  );
  expect(
    after.totalPoints === before.totalPoints,
    `${region}: receipt packages stay out of the balance totals`,
    `${before.totalPoints} -> ${after.totalPoints}`,
  );
  if (piId) {
    const intent = (await sim(`/v1/payment_intents/${piId}`)).body;
    expect(
      intent?.status === "succeeded" &&
        intent.amount === subtotal + tax &&
        intent.currency === currency.toLowerCase(),
      `${region}: the simulation's PaymentIntent succeeded for the at-cost total`,
      `${piId} ${intent?.status} ${intent?.amount} ${intent?.currency}`,
    );
  } else
    note(`${region}: no simulated card payment`, "the purchase was paid at once (demo region)");
  const programme = await ok(await programmeOf(owner, biz), `${region} programme`);
  expect(
    programme.remainingPoints >= 1_000,
    `${region}: the receipt programme counts the new package`,
    `earning ${programme.earning}, ${programme.remainingPoints} points left`,
  );
  if (region === "AU") {
    invoiceWatch.push({
      owner,
      biz,
      label: `${region} receipt purchase ${started.purchaseId}`,
      total: subtotal + tax,
      piId,
      sessionId,
      startedAt,
    });
  } else {
    note("ID: no invoice is expected", "only AU issues invoices while Indonesia is a demo (F104)");
  }
  saveState({
    [`package${region}`]: { purchaseId: started.purchaseId, allocationId: paid.allocationId },
  });
  return paid.allocationId;
}

// ------------------------------------------------------------- phase A

async function phaseA() {
  // 1. The approved funder settings, through the staff economy read.
  for (const region of ["AU", "ID"]) {
    const rows = await staffSettings(region);
    const row = rows.find(
      (r) => r.key === `receipt_funder.${PARTNER_ID}` && r.region === region && r.approvedBy,
    );
    expect(
      row?.value?.businessId === FUNDERS[region].biz,
      `staff settings: receipt_funder.${PARTNER_ID} is approved for ${region}`,
      `${short(row?.value)} approved by ${row?.approvedBy} (expected ${FUNDERS[region].biz})`,
    );
    const rp = rows.find((r) => r.key === "receipt_points");
    note(`${region} receipt_points`, short(rp?.value));
  }

  // 2. The funder's programme: three at-cost tiers.
  for (const region of ["AU", "ID"]) {
    const { biz, currency } = FUNDERS[region];
    const owner = await funderOwner(region);
    const res = await programmeOf(owner, biz);
    if (
      !expect(
        res.status === 200,
        `${region}: the funder's owner reads the receipt programme`,
        `HTTP ${res.status} ${res.status === 200 ? "" : short(res.body)}`,
      )
    )
      continue;
    const view = res.body;
    expect(
      view.partners?.join() === PARTNER_ID,
      `${region}: the programme names the partner it funds`,
      short(view.partners),
    );
    const tiers = Object.fromEntries(view.packages.map((x) => [x.tierKey, x]));
    for (const tier of Object.keys(TIER_POINTS)) {
      const p = tiers[tier];
      expect(
        p?.pricing === "at_cost" &&
          p.points === TIER_POINTS[tier] &&
          p.discountBps === 0 &&
          p.currency === currency &&
          p.taxRateBps === TAX_BPS[region] &&
          p.taxMinor === halfUpTax(p.subtotalMinor, TAX_BPS[region]) &&
          p.totalMinor === p.subtotalMinor + p.taxMinor,
        `${region}: ${tier} is at cost, no discount, tax is half-up of ${TAX_BPS[region]} bps`,
        short(p),
      );
    }
    const { starter, grow, scale } = tiers;
    if (starter && grow && scale) {
      expect(
        Math.abs(grow.subtotalMinor - 10 * starter.subtotalMinor) <= 10 &&
          Math.abs(scale.subtotalMinor - 50 * starter.subtotalMinor) <= 50,
        `${region}: subtotals are proportional to points (no volume discount)`,
        `starter ${starter.subtotalMinor}, grow ${grow.subtotalMinor}, scale ${scale.subtotalMinor} ${currency}`,
      );
      note(
        `${region} at-cost starter price`,
        `${starter.subtotalMinor} ${currency} ex-tax per 1,000 points`,
      );
      const ordinary = await ok(
        await call("GET", `${billing(biz)}/packages`, owner),
        `${region} ordinary packages`,
      );
      const o = ordinary.packages.find((x) => x.tierKey === "starter");
      const before = o ? o.subtotalMinor + o.savingMinor : null;
      expect(
        o && o.pricing !== "at_cost" && starter.subtotalMinor < before,
        `${region}: at cost is below the ordinary starter price before discounts`,
        `at cost ${starter.subtotalMinor} vs ordinary ${before} ${currency} (${o?.subtotalMinor} after its discount)`,
      );
    }
    expect(
      view.packages.length === 3 && view.packages.every((p) => p.pricing === "at_cost"),
      `${region}: exactly three tiers, every one at cost`,
      view.packages.map((p) => p.tierKey).join(","),
    );
    note(
      `${region} programme now`,
      `earning ${view.earning}, ${view.remainingPoints} points left, ${view.pointsPerReceipt} per receipt`,
    );
  }

  // 3. The negatives: a non-funder, a marketer, and the other region's owner.
  const harbour = (
    await ok(await call("GET", "/api/me/businesses", await login(demo("owner"))), "businesses")
  )
    .map((m) => m.business?.id)
    .find((id) => id && id !== FUNDERS.AU.biz);
  if (harbour) {
    const owner = await login(demo("owner"));
    const view = await programmeOf(owner, harbour);
    expect(
      view.status === 404 && view.body?.code === "not_a_receipt_funder",
      "a brand that is not a funder gets 404 not_a_receipt_funder on the programme",
      `HTTP ${view.status} ${short(view.body)}`,
    );
    const buy = await call("POST", `${billing(harbour)}/purchases`, owner, {
      tierKey: "starter",
      currency: "AUD",
      programme: "receipts",
    });
    expect(
      buy.status === 404 && buy.body?.code === "not_a_receipt_funder",
      "that brand cannot buy a receipt package either (refused before any checkout)",
      `HTTP ${buy.status} ${short(buy.body)}`,
    );
  } else note("owner.au has no second business", "the non-funder check was skipped");
  const marketer = await login(demo("member"));
  const denied = await call("POST", `${billing(FUNDERS.AU.biz)}/purchases`, marketer, {
    tierKey: "starter",
    currency: "AUD",
    programme: "receipts",
  });
  expect(
    denied.status === 403,
    "a marketer of the funder cannot buy a receipt package (RBAC)",
    `HTTP ${denied.status} ${short(denied.body)}`,
  );
  const crossRegion = await programmeOf(await login(FUNDERS.ID.ownerEmail), FUNDERS.AU.biz);
  expect(
    crossRegion.status === 403 || crossRegion.status === 404,
    "the Indonesian owner cannot read the AU funder's programme (tenancy)",
    `HTTP ${crossRegion.status}`,
  );

  // 4. The purchases.
  const force = FLAGS.has("--force");
  for (const region of ["AU", "ID"]) await buyReceiptStarter(region, { force });
}

// ------------------------------------------------------------- phase B

const AU = FUNDERS.AU;

async function statusAU() {
  return partner("/api/partners/receipts/status", { region: "AU" });
}

/** The pending proposal's id, then a second finance member approves it. */
async function changeReceiptPoints(value, reason) {
  const finance = await login(staff("finance"));
  const second = await login(FINANCE2);
  const proposed = await ok(
    await call("POST", "/api/staff/economy/AU/settings/proposals", finance, {
      key: "receipt_points",
      value,
      reason,
    }),
    "propose receipt_points",
  );
  expect(
    proposed.status === "pending",
    `finance proposes receipt_points = ${value} for AU`,
    `proposal ${proposed.id}`,
  );
  const self = await call(
    "POST",
    `/api/staff/economy/AU/settings/proposals/${proposed.id}/approve`,
    finance,
    { note: "self" },
  );
  expect(
    self.status === 403,
    "the proposer cannot approve their own setting",
    `HTTP ${self.status}`,
  );
  const approved = await ok(
    await call("POST", `/api/staff/economy/AU/settings/proposals/${proposed.id}/approve`, second, {
      note: "2.10.b check",
    }),
    "approve receipt_points",
  );
  expect(
    approved.status === "approved" && approved.approvedBy !== approved.proposedBy,
    `a second finance member approves receipt_points = ${value}`,
    `by ${approved.approvedBy}`,
  );
  say(`-- waiting ${SETTINGS_WAIT_MS / 1000} s for the setting to apply --`);
  await sleep(SETTINGS_WAIT_MS);
  const owner = await funderOwner("AU");
  const applied = await until(
    async () => {
      const v = await programmeOf(owner, AU.biz);
      return v.status === 200 && v.body.pointsPerReceipt === value ? v.body : null;
    },
    3 * 60_000,
    10_000,
  );
  expect(
    applied,
    `receipt_points = ${value} is in force`,
    applied ? "" : "the programme still shows the old value after 3 more minutes",
  );
  return Boolean(applied);
}

async function currentReceiptPoints() {
  const rows = await staffSettings("AU");
  const value = rows.find((r) => r.key === "receipt_points")?.value;
  return typeof value === "number" ? value : null;
}

/** Sends a receipt as the partner; the externalRef is unique to this run unless given. */
const receipt = (linkId, externalRef, key) =>
  partner(
    "/api/partners/actions",
    { linkId, action: "receipt_scanned", externalRef, evidence: { check: "2.10.b", run: RUN } },
    { key },
  );

async function linkUser(who) {
  const session = await stableUser(who);
  const code = (
    await ok(await call("POST", "/api/me/linked-apps/code", session, {}), `${who} link code`)
  ).code;
  const linked = await partner("/api/partners/links", { code });
  if (
    !expect(
      linked.status === 200 && linked.body?.linkId,
      `${who}.au is linked to ${PARTNER_ID}`,
      `HTTP ${linked.status} region ${linked.body?.region}`,
    )
  )
    throw new Error(`could not link ${who}: ${short(linked.body)}`);
  expect(linked.body.region === "AU", `${who}'s link is in AU`, linked.body.region);
  return { who, linkId: linked.body.linkId, session };
}

async function devInbox() {
  const res = await fetch(`${API}/api/dev/inbox`);
  return res.status === 200 ? (await res.json()).entries : null;
}

async function phaseB() {
  say(
    "WARNING: during the drain (receipt_points = 100) any real SnapApp scan on staging earns 100 points.\n" +
      "         Run this while staging is quiet. It restores receipt_points afterwards, or run `restore`.",
  );
  if (!FLAGS.has("--yes")) {
    fail(
      "phase-b needs --yes",
      "it changes AU receipt_points to 100 for a while (read the WARNING above)",
    );
    return;
  }
  if (!PARTNER_SECRET) throw new Error("needs SNAP_APP_PARTNER_SECRET in the environment");

  // Pre-flight: every actor, before anything is changed.
  const finance = await login(staff("finance"));
  const second = await login(FINANCE2);
  const me1 = await ok(await call("GET", "/api/staff/me", finance), "staff me");
  const me2 = await ok(await call("GET", "/api/staff/me", second), "staff me (second)");
  if (
    !me1.roles.includes("finance") ||
    !me2.roles.includes("finance") ||
    me1.userId === me2.userId
  ) {
    throw new Error(
      `the two-person rule needs two different finance staff; ${FINANCE2} has roles [${me2.roles}]. On the box: pnpm staff:add ${FINANCE2} finance, or set CHECK_FINANCE2_EMAIL.`,
    );
  }
  const owner = await funderOwner("AU");

  // 1. Status before the drain.
  const status0 = await statusAU();
  if (
    !expect(
      status0.status === 200 &&
        status0.body.region === "AU" &&
        typeof status0.body.earning === "boolean" &&
        Number.isInteger(status0.body.remainingPoints),
      "status AU answers 200 with earning and remainingPoints",
      `HTTP ${status0.status} ${short(status0.body)}`,
    )
  )
    return;
  note("status AU before the drain", short(status0.body));
  const unsigned = await fetch(`${API}/api/partners/receipts/status`, {
    method: "POST",
    headers: {
      authorization: `Partner ${PARTNER_ID}:${"0".repeat(64)}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({ region: "AU" }),
  });
  expect(
    unsigned.status === 401,
    "status with a wrong signature is refused",
    `HTTP ${unsigned.status}`,
  );

  const balance = await balanceOf(owner, AU.biz);
  const packages = receiptPackages(balance);
  const live = packages.filter((a) => a.remainingPoints > 0);
  const nowPoints = await currentReceiptPoints();
  const state = readState();
  say(
    `-- state found: receipt_points ${nowPoints}; ${packages.length} AU receipt package(s): ${
      packages.map((a) => `${a.remainingPoints}/${a.totalPoints} left`).join(", ") || "none"
    }${state.drainStartedAt ? `; a drain started ${state.drainStartedAt} and did not finish` : ""} --`,
  );
  if (nowPoints !== 1) {
    fail(
      `AU receipt_points is ${nowPoints}, not 1`,
      `a drain was probably interrupted (state file says original ${state.originalReceiptPoints ?? "unknown"}): run \`restore\` first, then phase-b again`,
    );
    return;
  }
  // The velocity gate (ledger risk) flags a user at 6 grants and blocks at 10 in 10 minutes, so no
  // user here gets more than 5 grants, and none more than 500 points a day.
  // Older packages with room are drained first by fillers (the draw is oldest first and never split).
  const older = live;
  const plan = older.map((a) => ({ a, n: Math.floor(a.remainingPoints / 100) }));
  const fillerTotal = plan.reduce((sum, x) => sum + x.n, 0);
  const leftover = older.reduce((sum, a) => sum + (a.remainingPoints % 100), 0);
  note(
    "older AU receipt packages with room",
    `${older.map((a) => `${a.remainingPoints}/${a.totalPoints}`).join(", ") || "none"}: ${fillerTotal} filler receipt(s) of 100 needed, ${leftover} point(s) will be left`,
  );
  const fillers = FILLER_USERS;
  if (fillerTotal > Math.min(10, fillers.length * 5)) {
    fail(
      "the older receipt packages need too many filler receipts",
      `${fillerTotal} needed, at most ${Math.min(10, fillers.length * 5)} allowed with ${fillers.length} filler user(s) (5 grants each per 10 minutes); clean up by hand. Nothing was sent or bought`,
    );
    return;
  }
  const refs = (who, n) => `check-2.10b-${RUN}-${who}-${n}`;

  // 2. The subject: a fresh Starter bought now. Alerts are checked on it alone.
  const subjectId = await buyReceiptStarter("AU", { force: true });
  if (!subjectId) return;
  saveState({ subjectAllocationId: subjectId });
  const pkg = receiptPackages(await balanceOf(owner, AU.biz)).find(
    (a) => a.allocationId === subjectId,
  );
  if (
    !expect(
      pkg && pkg.totalPoints === 1_000 && pkg.remainingPoints === 1_000,
      "the subject package is a fresh 1,000-point receipt package",
      short(pkg),
    )
  )
    return;
  const alertsFor = async () =>
    (await ok(await call("GET", `${billing(AU.biz)}/alerts`, owner), "alerts")).alerts.filter(
      (a) => a.subjectId === pkg.allocationId,
    );

  // 3. Drain: receipt_points = 100.
  const original = nowPoints;
  saveState({ originalReceiptPoints: original, drainStartedAt: new Date().toISOString() });
  let drained = false;
  try {
    if (!(await changeReceiptPoints(100, "2.10.b check: drain the receipt package"))) return;
    drained = true;

    const [a, b, c] = [await linkUser(USER_A), await linkUser(USER_B), await linkUser(USER_C)];
    // Fillers use up each older package until under 100 is left, so none can pay a receipt.
    let fillerNo = 0;
    for (const { a: old, n } of plan) {
      for (let i = 0; i < n; i++) {
        const who = fillers[Math.floor(fillerNo / 5)];
        const user = await linkUser(who);
        const res = await receipt(user.linkId, refs(`${who}-fill`, fillerNo));
        fillerNo += 1;
        if (!(res.status === 200 && res.body?.granted === true && res.body.points === 100)) {
          fail(
            `filler receipt ${fillerNo} of ${fillerTotal} from ${who}`,
            `HTTP ${res.status} ${short(res.body)}`,
          );
          return;
        }
      }
      if (n > 0)
        note("filler receipts", `${n} sent against the ${old.remainingPoints}-point package`);
    }
    if (fillerTotal > 0) {
      const afterFill = await statusAU();
      expect(
        afterFill.body?.remainingPoints === pkg.totalPoints + leftover,
        "the older packages are down to their leftovers, the subject is untouched",
        short(afterFill.body),
      );
    }
    const sent = [];
    const send = async (user, n) => {
      const ref = refs(user.who, n);
      const res = await receipt(user.linkId, ref);
      sent.push({ user, ref, res });
      expect(
        res.status === 200 &&
          res.body?.granted === true &&
          res.body.points === 100 &&
          res.body.duplicate === false,
        `receipt ${user.who}#${n} pays 100 points`,
        `HTTP ${res.status} ${short(res.body)}`,
      );
      return res;
    };
    const awaitAlert = async (pct) => {
      const alert = await until(
        async () => (await alertsFor()).find((x) => x.thresholdPct === pct) ?? null,
        ALERT_WAIT_MS,
        5_000,
      );
      if (!alert) {
        fail(
          `the ${pct}% receipt alert`,
          `none within ${ALERT_WAIT_MS / 60_000} min (alerts run every 2 minutes; is 2.10.b T6 deployed?)`,
        );
        return null;
      }
      expect(
        alert.programme === "receipts" &&
          alert.kind === "package" &&
          alert.totalPoints === pkg.totalPoints &&
          alert.usedPoints * 100 >= pct * pkg.totalPoints &&
          (pct === 100 ||
            alert.usedPoints * 100 < (pct === 50 ? 80 : 100) * pkg.totalPoints ||
            alert.usedPoints === pkg.totalPoints),
        `the ${pct}% alert is a receipt-package alert`,
        `${alert.id}: ${alert.usedPoints} of ${alert.totalPoints} used, programme ${alert.programme}`,
      );
      return alert;
    };

    for (let n = 1; n <= 5; n++) await send(a, n);
    const a50 = await awaitAlert(50);
    for (let n = 1; n <= 3; n++) await send(b, n);
    const a80 = await awaitAlert(80);
    for (let n = 4; n <= 5; n++) await send(b, n);
    const a100 = await awaitAlert(100);

    // 3. Paused: C is refused, nothing is paid.
    const refused = await receipt(c.linkId, refs(c.who, 1));
    expect(
      refused.status === 409 &&
        refused.body?.code === "allocation_exhausted" &&
        refused.body.message === PAUSED_MESSAGE,
      "a receipt after the package is used up answers 409 allocation_exhausted, receipt points paused",
      `HTTP ${refused.status} ${short(refused.body)}`,
    );
    expect(
      !JSON.stringify(refused.body ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-/),
      "the refusal leaks no ledger or business id",
    );
    const status1 = await statusAU();
    expect(
      status1.status === 200 &&
        status1.body.earning === false &&
        status1.body.remainingPoints === leftover &&
        leftover < 100,
      "status AU: earning:false, less than one receipt left",
      `HTTP ${status1.status} ${short(status1.body)}`,
    );

    // 4. Replays, before the rate is restored.
    const first = sent[0];
    const again = await receipt(first.user.linkId, first.ref, randomUUID());
    expect(
      again.status === 200 &&
        again.body?.granted === true &&
        again.body.points === 100 &&
        again.body.duplicate === true,
      "a paid receipt re-sent under a new key replays: granted, 100 points, duplicate",
      `HTTP ${again.status} ${short(again.body)}`,
    );
    const stolen = await receipt(c.linkId, first.ref, randomUUID());
    expect(
      stolen.status === 200 &&
        stolen.body?.granted === false &&
        stolen.body.points === 0 &&
        stolen.body.duplicate === true,
      "a receipt first reported for another user answers granted:false, 0 points, duplicate",
      `HTTP ${stolen.status} ${short(stolen.body)}`,
    );

    // 5. Alerts: each exactly once in Studio, and emailed.
    say("-- waiting 2.5 min for another alert sweep, to see nothing is raised twice --");
    await sleep(150_000);
    const final = await alertsFor();
    const counts = [50, 80, 100].map((p) => final.filter((x) => x.thresholdPct === p).length);
    expect(
      counts.join() === "1,1,1",
      "after another sweep each receipt alert exists exactly once",
      `50%:${counts[0]} 80%:${counts[1]} 100%:${counts[2]}`,
    );
    const inbox = await devInbox();
    if (inbox === null) {
      note(
        "the dev inbox is not readable here",
        "GET /api/dev/inbox did not answer 200: emails not checked",
      );
    } else {
      for (const alert of [a50, a80, a100]) {
        if (!alert) continue;
        const mails = inbox.filter(
          (m) => m.category === "budget_alert" && m.metadata?.alertId === alert.id,
        );
        const to = mails.map((m) => m.recipient).sort();
        note(
          `emails for the ${alert.thresholdPct}% alert`,
          `${to.length} in the dev inbox: ${to.join(", ") || "none"}`,
        );
        expect(
          to.includes(AU.ownerEmail),
          `the ${alert.thresholdPct}% alert was emailed to the funder's owner`,
          to.length === 0
            ? "nothing in the newest 50 messages (a recipient on the live allow-list gets real mail instead)"
            : "",
        );
        expect(
          new Set(to).size === to.length,
          `the ${alert.thresholdPct}% alert was emailed once per recipient`,
        );
        expect(
          mails.length > 0 && mails.every((m) => /receipt/i.test(`${m.subject ?? ""} ${m.body}`)),
          `the ${alert.thresholdPct}% email uses the receipt wording`,
          mails[0] ? `"${mails[0].subject}"` : "",
        );
      }
    }

    // 6. Restore the rate (the finally below covers a crash), buy a second package, earn again.
    drained = false;
    await changeReceiptPoints(original, "2.10.b check: restore receipt_points");
    saveState({ drainStartedAt: null });
    const before = (await statusAU()).body?.remainingPoints ?? 0;
    const newId = await buyReceiptStarter("AU", { force: true });
    if (newId) {
      const status2 = await until(
        async () => {
          const s = await statusAU();
          return s.status === 200 && s.body.earning === true ? s : null;
        },
        60_000,
        5_000,
      );
      expect(
        status2?.body.remainingPoints === before + 1_000,
        "status AU: earning:true with the new package's 1,000 points",
        short(status2?.body),
      );
      const fresh = await receipt(c.linkId, refs(c.who, "after"));
      expect(
        fresh.status === 200 &&
          fresh.body?.granted === true &&
          fresh.body.points === original &&
          fresh.body.duplicate === false,
        `a new receipt from ${c.who} earns ${original} point(s) from the new package`,
        `HTTP ${fresh.status} ${short(fresh.body)}`,
      );
    }
  } finally {
    if (drained) {
      note("restoring receipt_points after a failure", `to ${original}`);
      try {
        await changeReceiptPoints(original, "2.10.b check: restore receipt_points");
        saveState({ drainStartedAt: null });
      } catch (error) {
        fail(
          "receipt_points was NOT restored",
          `${error instanceof Error ? error.message : String(error)}; run the restore command`,
        );
      }
    }
  }
}

async function restore() {
  const original = readState().originalReceiptPoints ?? 1;
  const now = await currentReceiptPoints();
  if (now === original) {
    note("receipt_points is already back", String(now));
    return;
  }
  await changeReceiptPoints(original, "2.10.b check: restore receipt_points");
}

// ---------------------------------------------------------------- runner

const COMMANDS = { "phase-a": phaseA, "phase-b": phaseB, restore };

async function run(name) {
  const failedBefore = failures;
  say(`\n=== ${name} (run ${RUN}) ===`);
  try {
    await COMMANDS[name]();
    await checkInvoices();
  } catch (error) {
    fail(`${name} stopped`, error instanceof Error ? error.message : String(error));
  }
  const verdict = failures > failedBefore ? "FAIL" : "PASS";
  say(`=== ${name}: ${verdict} ===`);
}

const command = process.argv[2];
if (command && COMMANDS[command]) {
  await run(command);
} else {
  console.error(
    `usage: check-2.10b-receipt-package.mjs <${Object.keys(COMMANDS).join("|")}> [--force] [--yes]`,
  );
  process.exitCode = 2;
}
say(`\n${failures === 0 ? "RESULT: no failures" : `RESULT: ${failures} failure(s)`}`);
if (process.exitCode !== 2) process.exitCode = failures === 0 ? 0 : 1;
