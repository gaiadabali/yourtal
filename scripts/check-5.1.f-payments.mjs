#!/usr/bin/env node
// 5.1.f (YourTal 14.7.e, and the staging halves of group 5.2 and 5.3): every
// way YourTal takes and pays out money, on staging against the payment
// simulation, with evidence. Standalone: `fetch` only, no workspace imports,
// so a copy runs on Helios. The demo password and the simulation's key stay
// in the environment; nothing here prints a password, cookie, key or card.
//
//   node --env-file=/opt/yourtal/secrets/app.env check-5.1.f-payments.mjs <step>
//
// Steps: purchase | declined | three-ds | boost | manual | auction | payout | all
//   auction-settled <auctionId> <destination> <hold,hold,...>   (after the SQL `auction` prints)
//   payout-sim <statementId> <accountRef> <payoutRef>           (after the SQL `payout` prints)
// `all` runs the first seven in order, then prints the two follow-up commands.
//   budget-alerts   (5.10.c, YourTal 14.13.c; not part of `all`, it takes about 12 minutes)
//     Makes a fresh 15 s Short for au-harbour-grind through Studio (draft, a real
//     ffmpeg-made upload the worker transcodes, a 10 point total budget, submit,
//     staff approval), then watches it as five demo viewers in real time and
//     checks the 50%, 80% and 100% budget alerts each appear once, are emailed to
//     the owner and finance (read from the dev inbox), and that the next view
//     starts non-earning. Needs ffmpeg on PATH (or CHECK_VIDEO_FILE) and the worker.
//
// Env: STAGING_DEMO_PASSWORD (required), STAGING_REVIEW_PASSWORD (non-staff
// logins when set, like the demo reset), STRIPE_SECRET_KEY (the simulation's
// key, for independent evidence), STRIPE_API_BASE (default <api>/api/paysim),
// DEMO_API_BASE_URL (default http://127.0.0.1:26301), PAYSIM_PAGES_BASE_URL
// (where the simulation's hosted pages are fetched, default <api>/api/paysim),
// CHECK_INVOICE_WAIT_MIN (default 8), CHECK_PAYOUT_WAIT_MIN (default 15),
// CHECK_STATE_FILE (the auction step's notes, default in the temp directory),
// CHECK_ALERT_WAIT_MIN (budget-alerts: per alert, default 4), CHECK_MEDIA_WAIT_MIN
// (its transcode wait, default 5), CHECK_ALERT_REWARD, CHECK_VIDEO_FILE.
// `payout --new` skips an existing disbursement and proposes a fresh statement.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = (process.env.DEMO_API_BASE_URL ?? "http://127.0.0.1:26301").replace(/\/+$/, "");
const PASSWORD = process.env.STAGING_DEMO_PASSWORD;
const REVIEW_PASSWORD = process.env.STAGING_REVIEW_PASSWORD || PASSWORD;
const SIM_KEY = process.env.STRIPE_SECRET_KEY;
const SIM_API = (process.env.STRIPE_API_BASE ?? `${API}/api/paysim`).replace(/\/+$/, "");
const PAGES = (process.env.PAYSIM_PAGES_BASE_URL ?? `${API}/api/paysim`).replace(/\/+$/, "");
const INVOICE_WAIT_MS = Number(process.env.CHECK_INVOICE_WAIT_MIN ?? 8) * 60_000;
const PAYOUT_WAIT_MS = Number(process.env.CHECK_PAYOUT_WAIT_MIN ?? 15) * 60_000;
const STATE_FILE = process.env.CHECK_STATE_FILE ?? join(tmpdir(), "check-5.1.f-state.json");
if (!PASSWORD) throw new Error("needs STAGING_DEMO_PASSWORD");

const CARDS = {
  ok: "4242 4242 4242 4242",
  declined: "4000 0000 0000 0002",
  threeDs: "4000 0025 0000 3155",
};
const BANK = { bsb: "110000", account: "000123456" };
const RUN = randomUUID().slice(0, 8);
const DEMO_DOMAIN = "demo.yourtal.test";

// ---------------------------------------------------------------- output

const SECRETS = [PASSWORD, REVIEW_PASSWORD, SIM_KEY].filter((s) => s && s.length >= 6);
function scrub(text) {
  let out = String(text);
  for (const secret of SECRETS) out = out.split(secret).join("<redacted>");
  return out;
}
const say = (line) => console.log(scrub(line));
let failures = 0;
let pendings = 0;
const pass = (what, detail = "") => say(`PASS  ${what}${detail ? ` -- ${detail}` : ""}`);
const note = (what, detail = "") => say(`NOTE  ${what}${detail ? ` -- ${detail}` : ""}`);
function fail(what, detail = "") {
  failures += 1;
  say(`FAIL  ${what}${detail ? ` -- ${detail}` : ""}`);
}
function pending(what, detail = "") {
  pendings += 1;
  say(`WAIT  ${what}${detail ? ` -- ${detail}` : ""}`);
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

// ---------------------------------------------------------------- the API

async function call(method, path, session, body, { binary = false } = {}) {
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
  if (binary) return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
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

// ------------------------------------------------- the simulation's own API

async function sim(path, account) {
  if (!SIM_KEY)
    throw new Error("needs STRIPE_SECRET_KEY (the simulation's key) in the environment");
  const res = await fetch(`${SIM_API}${path}`, {
    headers: {
      authorization: `Bearer ${SIM_KEY}`,
      ...(account ? { "stripe-account": account } : {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // leave null
  }
  return { status: res.status, body };
}

/** The simulation's hosted pages, fetched the way a browser would, from where this runs. */
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
async function postForm(url, fields) {
  const res = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, location: res.headers.get("location"), html: await res.text() };
}
async function submitCard(checkoutUrl, number) {
  const url = pageUrl(checkoutUrl);
  return postForm(url, { csrf: await csrfOf(url), number, expiry: "12 / 34", cvc: "123" });
}
async function decideThreeDs(checkoutUrl, outcome) {
  const url = `${pageUrl(checkoutUrl).split("?")[0]}/3ds`;
  return postForm(url, { csrf: await csrfOf(url), outcome });
}

/** Saves the 4242 card for whoever owns `cardPath` (Studio billing or `/api/me/payment-card`). */
async function ensureCard(session, cardPath, who) {
  const current = await ok(await call("GET", cardPath, session), `${who} card`);
  if (current.required !== true) return { required: false, card: null };
  if (current.card) return { required: true, card: current.card, was: "already saved" };
  const started = await ok(await call("POST", cardPath, session, {}), `${who} start card`);
  if (typeof started.checkoutUrl !== "string") return { required: true, card: started.card };
  const submitted = await submitCard(started.checkoutUrl, CARDS.ok);
  if (submitted.status !== 303) throw new Error(`${who} card page answered ${submitted.status}`);
  const card = await until(
    async () => (await ok(await call("GET", cardPath, session), `${who} card`)).card,
    90_000,
    2_000,
  );
  if (!card)
    throw new Error(
      `${who}: the card was not saved within 90 s (is the simulation's webhook arriving?)`,
    );
  return { required: true, card, was: "saved now" };
}

/** Sets up a payout account through the real route and the simulation's onboarding page. */
async function ensurePayoutAccount(session, statusPath, legalName) {
  const read = async () =>
    (await ok(await call("GET", statusPath, session), `${legalName} payouts`)).account;
  let account = await read();
  if (account.available !== true || account.hostedOnboarding !== true || account.state === "ready")
    return account;
  const link = await ok(
    await call("POST", `${statusPath}/link`, session, {}),
    `${legalName} payout link`,
  );
  const url = pageUrl(link.url);
  const done = await postForm(url, { csrf: await csrfOf(url), legal_name: legalName, ...BANK });
  if (done.status !== 303) throw new Error(`${legalName} onboarding page answered ${done.status}`);
  account = await until(
    async () => {
      const a = await read();
      return a.state === "ready" ? a : null;
    },
    90_000,
    2_000,
  );
  if (!account) throw new Error(`${legalName}: the payout account was not ready within 90 s`);
  return account;
}

// ---------------------------------------------------- the demo brands

function stableId(seed) {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const AU_BRANDS = [
  "au-harbour-grind",
  "au-laneway-threads",
  "au-level-up",
  "au-little-sprouts",
  "au-pulse-fitness",
  "au-circuit",
].map((slug) => ({ slug, id: stableId(`demo-world:business:${slug}`) }));

async function ownerAndBrand(slug = "au-harbour-grind") {
  const owner = await login(demo("owner"));
  const mine = await ok(await call("GET", "/api/me/businesses", owner), "my businesses");
  const ids = new Set(mine.map((m) => m.business?.id));
  const brand = AU_BRANDS.find((b) => b.slug === slug && ids.has(b.id));
  if (!brand) throw new Error(`owner.au is not a member of ${slug}: run the demo reset first`);
  return { owner, biz: brand.id, brand };
}
const halfUpTax = (subtotal, bps) => Math.floor((subtotal * bps + 5_000) / 10_000);
const billing = (biz) => `/api/${biz}/studio/billing`;
const balanceOf = async (owner, biz) =>
  ok(await call("GET", `${billing(biz)}/balance`, owner), "balance");

// ---------------------------------------------------------- invoices (5.3)

const invoiceWatch = [];
let defer = false;
function expectInvoice(spec) {
  invoiceWatch.push(spec);
}
const claimed = new Set();

async function checkInvoices() {
  const todo = invoiceWatch.splice(0);
  if (todo.length === 0) return;
  say(
    `-- invoices: waiting up to ${INVOICE_WAIT_MS / 60_000} min for the invoice job (every 5 min) --`,
  );
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
        (i) => !claimed.has(i.id) && i.sourceKind === spec.kind && spec.match(i),
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
        `none after ${INVOICE_WAIT_MS / 60_000} min (is the worker's invoice.issue job running, and is the AU invoice_issuer setting approved?)`,
      );
      continue;
    }
    const lines = inv.lines.reduce((s, l) => [s[0] + l.subtotalMinor, s[1] + l.taxMinor], [0, 0]);
    expect(
      inv.subtotalMinor + inv.taxMinor === inv.totalMinor &&
        lines[0] === inv.subtotalMinor &&
        lines[1] === inv.taxMinor,
      `invoice ${inv.number} adds up for ${spec.label}`,
      `id ${inv.id}, ${inv.sourceKind}, subtotal ${inv.subtotalMinor} + GST ${inv.taxMinor} = ${inv.totalMinor} ${inv.currency}, ${inv.isTaxInvoice ? "tax invoice" : "not a tax invoice"}`,
    );
    if (spec.total !== undefined)
      expect(
        inv.totalMinor === spec.total,
        `invoice ${inv.number} total is what was paid`,
        `${inv.totalMinor} vs ${spec.total}`,
      );
    const pdf = await call(
      "GET",
      `/api/${spec.biz}/studio/invoices/${inv.id}/pdf`,
      spec.owner,
      undefined,
      { binary: true },
    );
    expect(
      pdf.status === 200 && pdf.body.subarray(0, 4).toString("latin1") === "%PDF",
      `invoice ${inv.number} PDF downloads`,
      `HTTP ${pdf.status}, ${pdf.body.length} bytes`,
    );
    const other = AU_BRANDS.find((b) => b.id !== spec.biz);
    const wrong = await call(
      "GET",
      `/api/${other.id}/studio/invoices/${inv.id}/pdf`,
      spec.owner,
      undefined,
      { binary: true },
    );
    expect(
      wrong.status === 404 || wrong.status === 403,
      `another business's tenant path does not serve invoice ${inv.number}`,
      `HTTP ${wrong.status}`,
    );
  }
}

// ----------------------------------------------------------------- steps

async function buy({ card, expect: want, tier = "starter" }) {
  const { owner, biz } = await ownerAndBrand();
  const before = await balanceOf(owner, biz);
  // F121/F122: a business buys a package; bigger ones cost less per point.
  const { packages } = await ok(await call("GET", `${billing(biz)}/packages`, owner), "packages");
  const per1000 = Object.fromEntries(packages.map((p) => [p.tierKey, p.pricePer1000Minor]));
  expect(
    per1000.starter > 0 && per1000.grow < per1000.starter && per1000.scale < per1000.grow,
    "packages on sale, bigger ones cheaper per 1,000 points",
    packages.map((p) => `${p.tierKey} ${p.points} pts at ${p.pricePer1000Minor}/1,000`).join(", "),
  );
  const quote = await ok(
    await call("GET", `${billing(biz)}/purchases/quote?tier=${tier}`, owner),
    "quote",
  );
  const points = quote.points;
  expect(
    quote.subtotalMinor > 0 &&
      quote.taxMinor === halfUpTax(quote.subtotalMinor, quote.taxRateBps) &&
      quote.taxRateBps > 0 &&
      quote.subtotalMinor + quote.taxMinor === quote.totalMinor &&
      quote.currency === "AUD",
    `quote for ${points} points: subtotal, GST and total`,
    `${quote.subtotalMinor} + ${quote.taxMinor} GST (${quote.taxRateBps} bps) = ${quote.totalMinor} ${quote.currency}`,
  );
  const startedAt = new Date();
  const res = await call("POST", `${billing(biz)}/purchases`, owner, {
    tierKey: tier,
    currency: "AUD",
  });
  const started = await ok(res, "start purchase");
  const sessionId = /\/checkout\/([^/?#]+)/.exec(started.checkoutUrl ?? "")?.[1];
  if (
    !expect(
      started.status === "awaiting_payment" &&
        sessionId &&
        started.purchase.totalMinor === quote.totalMinor,
      "purchase returns a checkout URL for the quoted total",
      `purchase ${started.purchaseId}, session ${sessionId}`,
    )
  )
    return;

  const poll = async () =>
    ok(
      await call("GET", `${billing(biz)}/purchases/${started.purchaseId}`, owner),
      "purchase status",
    );
  const submitted = await submitCard(started.checkoutUrl, card);
  const session = (await sim(`/v1/checkout/sessions/${sessionId}`)).body;
  const piId = session?.payment_intent ?? null;

  if (want === "declined") {
    expect(
      submitted.status === 200 && submitted.html.includes("Your card was declined."),
      "the page says the card was declined",
      `HTTP ${submitted.status}`,
    );
    await sleep(8_000);
    const row = await poll();
    expect(
      row.status === "pending" && row.allocationId === null,
      "the purchase stays pending, no allocation",
      `status ${row.status}`,
    );
    const after = await balanceOf(owner, biz);
    expect(
      after.totalPoints === before.totalPoints,
      "no points were granted",
      `${before.totalPoints} -> ${after.totalPoints}`,
    );
    const intent = piId ? (await sim(`/v1/payment_intents/${piId}`)).body : null;
    expect(
      !intent || intent.status !== "succeeded",
      "the simulation holds no succeeded payment for it",
      `PaymentIntent ${piId ?? "none"} ${intent?.status ?? ""}`,
    );
    return;
  }
  if (want === "three-ds") {
    expect(
      submitted.status === 303 && (submitted.location ?? "").includes("/3ds"),
      "3155 sends the browser to the 3-D Secure challenge",
      `HTTP ${submitted.status}`,
    );
    await sleep(6_000);
    expect(
      (await poll()).status === "pending",
      "the purchase is pending while the challenge is open",
    );
    const done = await decideThreeDs(started.checkoutUrl, "complete");
    expect(
      done.status === 303,
      "completing the challenge returns to the app",
      `HTTP ${done.status}`,
    );
  } else {
    expect(
      submitted.status === 303 && (submitted.location ?? "").includes(started.purchaseId),
      "4242 is accepted and returns to Studio",
      `HTTP ${submitted.status}`,
    );
  }
  const paid = await until(
    async () => {
      const row = await poll();
      return row.status === "paid" ? row : null;
    },
    120_000,
    2_000,
  );
  if (
    !expect(
      paid && paid.allocationId,
      "the purchase reaches paid with an allocation",
      `purchase ${started.purchaseId}, allocation ${paid?.allocationId}`,
    )
  )
    return;
  const after = await balanceOf(owner, biz);
  const allocation = after.allocations.find((a) => a.allocationId === paid.allocationId);
  expect(
    allocation?.totalPoints === points && after.totalPoints === before.totalPoints + points,
    `the allocation holds ${points} points`,
    `balance ${before.totalPoints} -> ${after.totalPoints}`,
  );
  const intent = (await sim(`/v1/payment_intents/${piId}`)).body;
  expect(
    intent?.status === "succeeded" &&
      intent.amount === quote.totalMinor &&
      intent.currency === "aud",
    "the simulation's PaymentIntent succeeded for the total",
    `${piId} ${intent?.status} ${intent?.amount}`,
  );
  expectInvoice({
    owner,
    biz,
    kind: "card_purchase",
    label: `purchase ${started.purchaseId}`,
    total: quote.totalMinor,
    match: (i) =>
      (i.paymentRef
        ? [piId, sessionId].includes(i.paymentRef)
        : new Date(i.issuedAt) >= startedAt) && i.totalMinor === quote.totalMinor,
  });
}

async function stepPurchase() {
  await buy({ card: CARDS.ok, expect: "paid" });
}
async function stepDeclined() {
  await buy({ card: CARDS.declined, expect: "declined" });
}
async function stepThreeDs() {
  await buy({ card: CARDS.threeDs, expect: "three-ds" });
}

async function stepBoost() {
  const { owner, biz } = await ownerAndBrand("au-harbour-grind");
  const card = await ensureCard(owner, `${billing(biz)}/card`, "brand");
  expect(
    card.required === true && card.card,
    "the brand has a saved card for boosts",
    `${card.card?.brand} ending ${card.card?.last4} (${card.was ?? ""})`,
  );
  const { charges } = await ok(
    await call("GET", `${billing(biz)}/boost-charges`, owner),
    "boost charges",
  );
  const byRef = new Map();
  for (const c of charges)
    byRef.set(c.providerReference, [...(byRef.get(c.providerReference) ?? []), c]);
  const stripe = [...byRef].filter(([ref]) => ref.startsWith("pi_"));
  note(
    "boost charge batches",
    `${charges.length} daily charges in ${byRef.size} batches, ${stripe.length} through the simulation's Stripe`,
  );
  if (stripe.length === 0) {
    pending(
      "no boost batch has been charged through the simulation yet",
      "the job charges closed days hourly at :15; re-run after the next :15 once a boosted day has closed",
    );
    return;
  }
  for (const [ref, rows] of stripe) {
    const total = rows.reduce((s, c) => s + c.amountMinor, 0);
    const intent = (await sim(`/v1/payment_intents/${ref}`)).body;
    expect(
      intent?.status === "succeeded" && intent.amount === total,
      `batch ${ref} is a succeeded PaymentIntent for the batch total`,
      `${rows.length} day(s) ${rows.map((r) => r.day).join(",")}, ${total} aud, simulation says ${intent?.status} ${intent?.amount}`,
    );
    const recent = Date.now() - Math.max(...rows.map((r) => Date.parse(r.chargedAt))) < 10 * 60_000;
    expectInvoice({
      owner,
      biz,
      kind: "boost_batch",
      label: `boost batch ${ref}`,
      total,
      match: (i) => i.paymentRef === ref,
    });
    if (!recent)
      note(`batch ${ref} was charged over 10 min ago`, "its invoice should already exist");
  }
}

async function stepManual() {
  const { owner, biz } = await ownerAndBrand();
  const finance = await login(staff("finance"));
  const admin = await login(staff("admin"));
  const before = await balanceOf(owner, biz);
  const quote = await ok(
    // Starter is 1,000 points at the undiscounted rate: what a bank purchase of 1,000 pays.
    await call("GET", `${billing(biz)}/purchases/quote?tier=starter`, owner),
    "quote",
  );
  const bankReference = `check-5.1.f-${RUN}`;
  const proposed = await call("POST", "/api/staff/economy/AU/purchases", finance, {
    businessId: biz,
    points: 1000,
    paidMinor: quote.subtotalMinor,
    bankReference,
    reason: "5.1.f check: manual bank-transfer purchase",
  });
  const proposal = await ok(proposed, "propose manual purchase");
  expect(
    proposal.status === "pending" && proposal.kind === "manual_purchase",
    "finance proposes the manual purchase",
    `proposal ${proposal.id}`,
  );
  const self = await call(
    "POST",
    `/api/staff/economy/AU/purchases/${proposal.id}/approve`,
    finance,
    { note: "self" },
  );
  expect(
    self.status === 403,
    "the proposer cannot approve their own proposal",
    `HTTP ${self.status}`,
  );
  const startedAt = new Date();
  const approved = await ok(
    await call("POST", `/api/staff/economy/AU/purchases/${proposal.id}/approve`, admin, {
      note: "5.1.f check",
    }),
    "approve manual purchase",
  );
  expect(
    approved.status === "approved" && approved.approvedBy !== approved.proposedBy,
    "a second staff member approves it",
    `by ${approved.approvedBy}`,
  );
  const after = await balanceOf(owner, biz);
  expect(
    after.totalPoints === before.totalPoints + 1000,
    "the brand's points rose by 1,000",
    `${before.totalPoints} -> ${after.totalPoints}`,
  );
  const tax = halfUpTax(quote.subtotalMinor, quote.taxRateBps);
  expectInvoice({
    owner,
    biz,
    kind: "manual_purchase",
    label: `manual purchase ${proposal.id}`,
    total: quote.subtotalMinor + tax,
    match: (i) => i.paymentRef === bankReference && new Date(i.issuedAt) >= startedAt,
  });
}

// ----------------------------------------------------------- the auction

async function activeVouchers(session) {
  const body = await ok(await call("GET", "/api/wallet/vouchers", session), "wallet vouchers");
  return (body.vouchers ?? []).filter((v) => v.status === "active").map((v) => v.voucherId);
}
async function buyVoucher(session) {
  const admin = await login(staff("admin"));
  await call("POST", `/api/staff/users/${session.userId}/goodwill`, admin, {
    points: 300,
    reason: "5.1.f check starting balance",
  });
  await call("POST", "/api/dev/clock/release-pending", session, {});
  const wallet = await ok(await call("GET", "/api/wallet", session), "wallet");
  const listings =
    (await ok(await call("GET", "/api/store/listings", session), "store")).data ?? [];
  const before = new Set(await activeVouchers(session));
  for (const listing of listings) {
    const quote = await call("POST", "/api/checkout/quote", session, {
      listingId: listing.id ?? listing.listingId,
    });
    if (quote.status >= 400 || Number(quote.body?.pricePoints) > Number(wallet.availablePoints))
      continue;
    const bought = await call("POST", "/api/checkout", session, {
      checkoutId: quote.body.checkoutId,
    });
    if (bought.status < 400)
      return (
        bought.body?.voucherId ??
        (await activeVouchers(session)).find((v) => !before.has(v)) ??
        null
      );
  }
  return null;
}

/** Lists one voucher for the first charity that takes it: `{ auction, charity }` or `{ code }`. */
async function listForCharity(seller, voucherId, charities) {
  let code = "no charities";
  for (const charity of charities) {
    const res = await call("POST", `/api/wallet/vouchers/${voucherId}/auction`, seller, {
      charityId: charity.id,
    });
    if (res.status < 300) return { charity, auction: res.body };
    code = res.body?.code ?? `HTTP ${res.status}`;
    if (code !== "charity_not_ready") return { code };
  }
  return { code };
}

async function onboardCharities() {
  for (const who of ["charity1", "charity2"]) {
    const member = await login(demo(who));
    for (const c of (await ok(await call("GET", "/api/me/charities", member), "my charities"))
      .charities ?? []) {
      await ensurePayoutAccount(member, `/api/charities/${c.id}/payouts`, c.name);
    }
  }
}

/**
 * Finds a voucher an AU demo viewer may auction (a gifted one cannot: one hop only), buying a
 * fresh one when none can be listed, and lists it. Returns the seller, voucher and listing.
 */
async function listSomeVoucher(sellers, charities) {
  const refusals = [];
  let onboarded = false;
  const attempt = async (seller, voucherId) => {
    let listed = await listForCharity(seller, voucherId, charities);
    if (listed.code === "charity_not_ready" && !onboarded) {
      note(
        "no AU charity is ready to take payments yet",
        "onboarding the demo charities through the simulation's page",
      );
      onboarded = true;
      await onboardCharities();
      listed = await listForCharity(seller, voucherId, charities);
    }
    if (listed.auction) return { seller, voucherId, ...listed };
    refusals.push(`${seller.email}/${voucherId.slice(0, 8)}: ${listed.code}`);
    return null;
  };
  for (const seller of sellers) {
    for (const voucherId of await activeVouchers(seller)) {
      const done = await attempt(seller, voucherId);
      if (done) return done;
    }
  }
  for (const seller of sellers) {
    const voucherId = await buyVoucher(seller);
    if (!voucherId) {
      refusals.push(`${seller.email}: could not buy a voucher`);
      continue;
    }
    const done = await attempt(seller, voucherId);
    if (done) return done;
  }
  return { refusals };
}

async function stepAuction() {
  const sellers = [];
  for (const who of ["viewer", "member", "adult", "guardian"]) sellers.push(await login(demo(who)));
  const charities =
    (await ok(await call("GET", "/api/charities?region=AU", sellers[0]), "charities")).charities ??
    [];
  const listed = await listSomeVoucher(sellers, charities);
  if (
    !expect(
      listed.auction,
      "an AU demo viewer lists a voucher for an AU charity whose payouts are ready",
      listed.auction
        ? `${listed.seller.email}, voucher ${listed.voucherId}, auction ${listed.auction.auctionId} for ${listed.charity.name}`
        : listed.refusals.join("; "),
    )
  )
    return;
  const seller = listed.seller;
  const [a, b] = [demo("adult"), demo("guardian"), demo("member"), demo("viewer")]
    .filter((e) => e !== seller.email)
    .slice(0, 2);
  const bidders = [await login(a), await login(b)];
  const auctionId = listed.auction.auctionId;

  const cards = [];
  for (const who of bidders) {
    const card = await ensureCard(who, "/api/me/payment-card", "bidder");
    cards.push(card);
  }
  expect(
    cards.every((c) => c.required && c.card),
    "both bidders have a saved card",
    cards
      .map((c, i) => `${bidders[i].email}: ${c.card?.brand} ending ${c.card?.last4} (${c.was})`)
      .join("; "),
  );

  const bid = async (who) => {
    const view = await ok(await call("GET", `/api/auctions/${auctionId}`, who), "auction");
    const res = await call("POST", `/api/auctions/${auctionId}/bids`, who, {
      amountMinor: view.minimumNextBidMinor,
    });
    return { res, amount: view.minimumNextBidMinor };
  };
  const placed = [];
  for (const who of [bidders[0], bidders[1], bidders[0]]) {
    const { res, amount } = await bid(who);
    if (
      !expect(
        res.status < 300,
        `${who.email} bids ${amount}`,
        `HTTP ${res.status} ${res.status >= 300 ? short(res.body) : `bids ${res.body.bidCount}, standing ${res.body.viewer.bidStatus}`}`,
      )
    )
      return;
    placed.push({ who: who.email, amount });
  }
  const viewA = await ok(await call("GET", `/api/auctions/${auctionId}`, bidders[0]), "auction");
  const viewB = await ok(await call("GET", `/api/auctions/${auctionId}`, bidders[1]), "auction");
  expect(
    viewA.bidCount === 3 &&
      viewA.viewer.bidStatus === "leading" &&
      viewB.viewer.bidStatus === "outbid",
    "the first bidder leads after raising; the second is outbid",
    `A ${viewA.viewer.bidStatus}, B ${viewB.viewer.bidStatus}, current ${viewA.currentAmountMinor}`,
  );
  const teen = await login(demo("teen")).catch(() => null);
  if (teen) {
    const refused = await call("POST", `/api/auctions/${auctionId}/bids`, teen, {
      amountMinor: viewA.minimumNextBidMinor,
    });
    expect(refused.status === 403, "a teen cannot bid", `HTTP ${refused.status}`);
  }
  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      auctionId,
      bidders: [a, b],
      seller: seller.email,
      placed,
      charityId: listed.charity.id,
    }),
  );

  const id = auctionId;
  // Printed into SQL the lead runs as the owner: only a well-formed UUID ever gets there.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    throw new Error(
      `refusing to print SQL for an auction id that is not a UUID: ${String(id).slice(0, 40)}`,
    );
  }
  say("");
  say(
    "== run this on the box, as the database owner, to end the auction now (it ends after 72 h otherwise) ==",
  );
  say(
    `WITH ended AS (UPDATE auction.auction SET ends_at = now() - interval '1 second' WHERE id = '${id}' AND state = 'open' RETURNING id)`,
  );
  say(
    `SELECT 'node check-5.1.f-payments.mjs auction-settled ' || a.id || ' ' || c.payout_reference || ' ' || (SELECT string_agg(b.hold_reference, ',' ORDER BY b.created_at) FROM auction.bid b WHERE b.auction_id = a.id) AS next FROM auction.auction a JOIN charity.charity c ON c.id = a.charity_id WHERE a.id = '${id}';`,
  );
  say(
    "== then run the command it prints (with the same --env-file). Settlement: the API's own 30 s sweep closes it, and any read of the auction closes it at once; the step reads it, so no wait is needed. ==",
  );
}

async function stepAuctionSettled([auctionId, destination, holdsCsv]) {
  if (!auctionId || !destination || !holdsCsv)
    throw new Error("usage: auction-settled <auctionId> <destination> <hold,hold,...>");
  const holds = holdsCsv.split(",");
  let state = {};
  try {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    note("no notes from the auction step", "winner and loser are taken from the simulation alone");
  }
  const emails = state.auctionId === auctionId ? state.bidders : [demo("adult"), demo("guardian")];
  const people = [];
  for (const e of emails) people.push(await login(e));
  const closed = await until(
    async () => {
      const v = await ok(await call("GET", `/api/auctions/${auctionId}`, people[0]), "auction");
      return v.state === "ended" ? v : null;
    },
    120_000,
    5_000,
  );
  if (
    !expect(
      closed && closed.outcome === "sold",
      "the auction closed as sold",
      closed ? `outcome ${closed.outcome}` : "still open: was the SQL run?",
    )
  )
    return;
  const win = closed.currentAmountMinor;
  const views = [];
  for (const p of people)
    views.push(
      (await ok(await call("GET", `/api/auctions/${auctionId}`, p), "auction")).viewer.bidStatus,
    );
  expect(
    views.filter((s) => s === "won").length === 1 && views.filter((s) => s === "lost").length === 1,
    "one bidder won, the other lost",
    `${emails.map((e, i) => `${e}: ${views[i]}`).join("; ")}, winning ${win}`,
  );

  const intents = [];
  for (const ref of holds) intents.push((await sim(`/v1/payment_intents/${ref}`)).body);
  intents.forEach((pi, i) =>
    say(
      `      hold ${i + 1}: ${holds[i]} ${pi?.status} ${pi?.amount} -> ${pi?.transfer_data?.destination}`,
    ),
  );
  expect(
    intents[0]?.status === "canceled",
    "the first bidder's earlier hold is canceled in the simulation",
    holds[0],
  );
  const succeeded = intents.filter((pi) => pi?.status === "succeeded");
  expect(
    succeeded.length === 1 &&
      succeeded[0].amount_received === win &&
      succeeded[0].transfer_data?.destination === destination,
    "exactly one hold succeeded, for the winning amount, with the charity's account as destination",
    `${succeeded[0]?.id} ${succeeded[0]?.amount_received} -> ${succeeded[0]?.transfer_data?.destination}`,
  );
  expect(
    intents.every((pi) => pi && ["succeeded", "canceled"].includes(pi.status)) &&
      intents.filter((pi) => pi.status === "canceled").length === holds.length - 1,
    "every other hold, the loser's included, is canceled",
    intents.map((p) => p?.status).join(", "),
  );
  const balance = (await sim("/v1/balance", destination)).body;
  const acct = (await sim(`/v1/accounts/${destination}`)).body;
  note(
    "charity account in the simulation",
    `available ${balance?.available?.[0]?.amount} aud, payouts_enabled ${acct?.payouts_enabled}; charity accounts pay out daily, so the credit of ${win} is swept into a payout within seconds and the balance rests at 0 (the PaymentIntent above is the proof of the transfer)`,
  );
}

// ---------------------------------------------------------------- payout

async function stepPayout(args) {
  const admin = await login(staff("admin"));
  const finance = await login(staff("finance"));
  const { owner } = await ownerAndBrand();
  const demoIds = new Map(AU_BRANDS.map((b) => [b.id, b]));
  const disbursements = async () =>
    (
      await ok(await call("GET", "/api/staff/settlement/AU/disbursements", admin), "disbursements")
    ).disbursements.filter((d) => demoIds.has(d.businessId));

  let target = null;
  const existing = await disbursements();
  const live =
    existing.find((d) => ["queued", "awaiting_account", "transferred"].includes(d.status)) ??
    existing.find((d) => d.status === "paid");
  if (live && !args.includes("--new")) {
    target = {
      statementId: live.statementId,
      businessId: live.businessId,
      amount: live.amountMinor,
    };
    note(
      "using the demo brand's existing disbursement",
      `statement ${live.statementId}, ${live.status}`,
    );
  } else {
    const queue = (
      await ok(await call("GET", "/api/staff/settlement/AU/queue", admin), "statement queue")
    ).statements;
    const proposals = await ok(
      await call("GET", "/api/staff/settlement/AU/payout-proposals", admin),
      "payout proposals",
    );
    const taken = new Set(proposals.map((p) => /statement (\S+)/.exec(p.summary)?.[1]));
    const mine = queue.filter((s) => demoIds.has(s.businessId));
    const now = Date.now();
    const ready = mine.filter(
      (s) =>
        s.status === "open" &&
        s.closingPayableMinor > 0 &&
        Date.parse(s.disputeWindowEndsAt) <= now &&
        !taken.has(s.id),
    );
    if (ready.length === 0) {
      const positive = mine.filter((s) => s.closingPayableMinor > 0);
      const windowOpen = positive.filter((s) => Date.parse(s.disputeWindowEndsAt) > now);
      const earliest = windowOpen.map((s) => s.disputeWindowEndsAt).sort()[0];
      pending(
        "no AU statement can be paid out yet",
        `queue holds ${queue.length} open/disputed AU statements, ${mine.length} for demo brands, ${positive.length} with a positive payable, ${windowOpen.length} still inside the 7-day dispute window${earliest ? ` (earliest closes ${earliest})` : ""}, ${positive.filter((s) => taken.has(s.id)).length} already proposed. ` +
          "Missing: a statement for a demo brand with closingPayableMinor > 0 whose period ended 7+ days ago. Nothing in the worker generates statements; they come from the ledger service's worker-only route POST /v1/economy/statements/generate (body businessId, region AU, from, to; `to` 7+ days ago, covering voucher redemptions at that brand), which no worker job calls yet.",
      );
      return;
    }
    const s = ready.sort((x, y) => y.closingPayableMinor - x.closingPayableMinor)[0];
    const ownerFor = await ownerAndBrand(demoIds.get(s.businessId).slug);
    await ensurePayoutAccount(
      ownerFor.owner,
      `${billing(s.businessId)}/payouts`,
      demoIds.get(s.businessId).slug,
    );
    const proposal = await ok(
      await call("POST", `/api/staff/settlement/AU/statements/${s.id}/payout-proposals`, finance, {
        reason: "5.1.f check",
      }),
      "propose payout",
    );
    expect(
      proposal.status === "pending",
      "finance proposes the statement payout",
      `statement ${s.id}, payable ${s.closingPayableMinor}`,
    );
    const self = await call(
      "POST",
      `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      finance,
      { note: "self" },
    );
    expect(
      self.status === 403,
      "the proposer cannot approve their own payout",
      `HTTP ${self.status}`,
    );
    const approved = await ok(
      await call(
        "POST",
        `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
        admin,
        { note: "5.1.f check" },
      ),
      "approve payout",
    );
    expect(
      approved.status === "approved",
      "a second staff member approves it",
      `proposal ${proposal.id}`,
    );
    target = { statementId: s.id, businessId: s.businessId, amount: s.closingPayableMinor };
  }

  const brand = demoIds.get(target.businessId);
  const studio = await ownerAndBrand(brand.slug);
  const rowOf = async () =>
    (
      await ok(
        await call("GET", `${billing(target.businessId)}/payouts`, studio.owner),
        "studio payouts",
      )
    ).payouts.find((p) => p.statementId === target.statementId);
  say(
    `-- waiting up to ${PAYOUT_WAIT_MS / 60_000} min for the disbursement job (every 5 min) and the simulated bank --`,
  );
  let lastStatus = "";
  const paid = await until(
    async () => {
      const row = await rowOf();
      if (row && row.status !== lastStatus) {
        lastStatus = row.status;
        say(
          `      ${new Date().toISOString().slice(11, 19)} statement ${target.statementId}: ${row.status}`,
        );
      }
      if (row?.status === "failed") throw new Error(`the payout failed: ${row.failureCode}`);
      return row?.status === "paid" ? row : null;
    },
    PAYOUT_WAIT_MS,
    10_000,
  );
  if (!paid) {
    fail(
      "the disbursement reaches paid",
      `still ${lastStatus || "absent"} after ${PAYOUT_WAIT_MS / 60_000} min`,
    );
    return;
  }
  expect(
    /^\d{4}$/.test(paid.bankLast4 ?? "") && paid.paidAt && paid.amountMinor === target.amount,
    "Studio's payouts list shows it paid with the bank's last four",
    `${paid.amountMinor} ${paid.currency}, bank ending ${paid.bankLast4}, paid ${paid.paidAt}`,
  );
  if (paid.bankLast4 !== BANK.account.slice(-4))
    note(
      "bank last four is not the demo test account's",
      `${paid.bankLast4} vs ${BANK.account.slice(-4)}`,
    );
  const staffRow = (await disbursements()).find((d) => d.statementId === target.statementId);
  expect(
    staffRow?.status === "paid",
    "the staff settlement screen agrees",
    `status ${staffRow?.status}`,
  );
  say("");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(target.statementId))) {
    throw new Error(`refusing to print SQL for a statement id with unexpected characters`);
  }
  say("== run this on the box to get the simulation's references, then the command it prints ==");
  say(
    `SELECT 'node check-5.1.f-payments.mjs payout-sim ' || statement_id || ' ' || account_ref || ' ' || payout_ref FROM payment.disbursement WHERE statement_id = '${target.statementId}';`,
  );
}

async function stepPayoutSim([statementId, accountRef, payoutRef]) {
  if (!statementId || !accountRef || !payoutRef)
    throw new Error("usage: payout-sim <statementId> <accountRef> <payoutRef>");
  const admin = await login(staff("admin"));
  const row = (
    await ok(await call("GET", "/api/staff/settlement/AU/disbursements", admin), "disbursements")
  ).disbursements.find((d) => d.statementId === statementId);
  if (!expect(row, "the disbursement exists", statementId)) return;
  const payout = (await sim(`/v1/payouts/${payoutRef}`, accountRef)).body;
  expect(
    payout?.status === "paid" && payout.amount === row.amountMinor,
    "the simulation shows a paid payout on the brand's connected account",
    `${payoutRef} ${payout?.status} ${payout?.amount} aud on ${accountRef}`,
  );
  const acct = (await sim(`/v1/accounts/${accountRef}`)).body;
  const bank = acct?.external_accounts?.data?.[0];
  expect(
    acct?.payouts_enabled === true && bank?.last4 === row.bankLast4,
    "the connected account is payout-enabled and its bank matches Studio's last four",
    `bank ending ${bank?.last4}, Studio ${row.bankLast4}`,
  );
  const balance = (await sim("/v1/balance", accountRef)).body;
  note(
    "brand account balance after the payout",
    `${balance?.available?.[0]?.amount} aud (the payout drew it down; it could only be created because the transfer had credited the account)`,
  );
}

// ------------------------------------------------- budget alerts (5.10.c)

const ALERT_VIEWS = 5; // a budget of five completions: 40% after two views, then 60%, 80%, 100%
const ALERT_VIDEO_SECONDS = 15; // AU's 8 points a minute ceiling pays 2 points for 15 s
const ALERT_WAIT_MS = Number(process.env.CHECK_ALERT_WAIT_MIN ?? 4) * 60_000;
const ALERT_MEDIA_WAIT_MS = Number(process.env.CHECK_MEDIA_WAIT_MIN ?? 5) * 60_000;
const ALERT_SWEEP_MS = 2 * 60_000; // the API's own sweep interval
const BUDGET_REFUSAL = "This campaign has given out all its rewards.";

/** A real, tiny MP4 for the Short: made with ffmpeg unless CHECK_VIDEO_FILE names one. */
function alertVideo() {
  if (process.env.CHECK_VIDEO_FILE) return readFileSync(process.env.CHECK_VIDEO_FILE);
  const out = join(tmpdir(), `check-5.10.c-${RUN}.mp4`);
  const made = spawnSync(
    "ffmpeg",
    [
      ...["-y", "-loglevel", "error", "-f", "lavfi", "-i"],
      `testsrc2=size=320x180:rate=15:duration=${ALERT_VIDEO_SECONDS}`,
      ...["-f", "lavfi", "-i", `sine=frequency=440:duration=${ALERT_VIDEO_SECONDS}`],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out],
    ],
    { encoding: "utf8" },
  );
  if (made.status !== 0)
    throw new Error(
      `needs ffmpeg on PATH to make the test video (or CHECK_VIDEO_FILE, a ${ALERT_VIDEO_SECONDS} s mp4): ${made.error?.message ?? made.stderr}`,
    );
  const bytes = readFileSync(out);
  rmSync(out, { force: true });
  return bytes;
}

/** The Short's video, uploaded through Studio's media routes and transcoded by the worker. */
async function uploadShort(owner, biz, campaignId) {
  const bytes = alertVideo();
  const init = await ok(
    await call("POST", `/api/${biz}/studio/media/initiate`, owner, {
      campaignId,
      filename: "budget-alert-check.mp4",
      contentType: "video/mp4",
      sizeBytes: bytes.length,
      teaserStartSeconds: 0,
    }),
    "media initiate",
  );
  const parts = [];
  for (const part of init.parts) {
    const from = (part.partNumber - 1) * init.partSizeBytes;
    const put = await fetch(part.url, {
      method: "PUT",
      body: bytes.subarray(from, from + init.partSizeBytes),
    });
    const eTag = put.headers.get("etag");
    if (!put.ok || !eTag) throw new Error(`upload part ${part.partNumber}: HTTP ${put.status}`);
    parts.push({ partNumber: part.partNumber, eTag });
  }
  await ok(
    await call("POST", `/api/${biz}/studio/media/${init.assetId}/complete`, owner, { parts }),
    "media complete",
  );
  let asset = null;
  const ready = await until(
    async () => {
      asset = await ok(
        await call("GET", `/api/${biz}/studio/media/${init.assetId}`, owner),
        "media asset",
      );
      return asset.status === "ready" || asset.status === "failed" ? asset : null;
    },
    ALERT_MEDIA_WAIT_MS,
    3_000,
  );
  if (!ready)
    throw new Error(
      `the video was still ${asset?.status} after ${ALERT_MEDIA_WAIT_MS / 60_000} min (is the worker running?)`,
    );
  if (ready.status === "failed") throw new Error(`transcode failed: ${ready.failureReason}`);
  return { assetId: init.assetId, seconds: ready.durationSeconds };
}

/**
 * A fresh Short for the demo brand, made through the real routes: draft, video,
 * a tiny total budget funded from the brand's own points, submit, staff approval.
 */
async function createBudgetShort(owner, biz) {
  const now = Date.now();
  const title = `Budget alert check ${RUN}`;
  const draft = await ok(
    await call("POST", `/api/${biz}/studio/campaigns`, owner, {
      kind: "quick",
      title,
      synopsis: "A short campaign with a tiny budget, made to prove the budget alerts.",
      durationSeconds: ALERT_VIDEO_SECONDS,
      contentCategory: "food-and-drink",
      audience: "all_ages",
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 7 * 24 * 3_600_000).toISOString(),
    }),
    "create the Short",
  );
  const campaignId = draft.id;
  const media = await uploadShort(owner, biz, campaignId);
  pass(
    "the test Short's video was uploaded and transcoded",
    `campaign ${campaignId}, asset ${media.assetId}, ${media.seconds} s`,
  );

  const funding = await ok(
    await call("GET", `/api/${biz}/studio/campaign-funding`, owner),
    "campaign funding",
  );
  const reward = Number(
    process.env.CHECK_ALERT_REWARD ?? Math.max(1, Math.floor((8 * media.seconds) / 60)),
  );
  const budget = reward * ALERT_VIEWS;
  const allocation = funding
    .filter((a) => a.remainingPoints >= budget)
    .sort((a, b) => b.remainingPoints - a.remainingPoints)[0];
  if (!allocation)
    throw new Error(`the brand has no partner allocation with ${budget} points left`);
  const saved = await call("PUT", `/api/${biz}/studio/campaigns/${campaignId}/reward`, owner, {
    allocationId: allocation.allocationId,
    rewardPointsPerCompletion: reward,
    accuracyBonusPoints: 0,
    maxPointsForCampaign: budget,
    dailyCapPoints: null,
  });
  if (saved.status !== 200)
    throw new Error(
      `reward config: HTTP ${saved.status} ${short(saved.body)} (${reward} points for ${media.seconds} s; CHECK_ALERT_REWARD overrides)`,
    );

  await ok(
    await call("POST", `/api/${biz}/studio/campaigns/${campaignId}/submit`, owner),
    "submit",
  );
  const moderator = await login(staff("moderator"));
  await ok(
    await call("POST", `/api/staff/moderation/campaigns/${campaignId}/approve`, moderator, {
      reason: "Budget alert check: a test Short with a tiny budget.",
    }),
    "staff approval",
  );
  const live = await until(
    async () => {
      const row = await ok(
        await call("GET", `/api/${biz}/studio/campaigns/${campaignId}`, owner),
        "campaign",
      );
      return row.lifecycleState === "live" ? row : null;
    },
    60_000,
    2_000,
  );
  if (!live) throw new Error("the Short was not live 60 s after the staff approval");
  pass(
    "the test Short is live with a tiny total budget",
    `${campaignId}, ${budget} points (${reward} a view, ${ALERT_VIEWS} views), funded from allocation ${allocation.allocationId}`,
  );
  return { campaignId, title, reward, budget, seconds: media.seconds };
}

/** Starts a session as `viewer`; `finish` watches in real time, as the player would, and completes. */
async function startView(viewer, campaignId, seconds) {
  const started = await call("POST", "/api/watch/sessions", viewer, { campaignId });
  if (started.status !== 201)
    throw new Error(`${viewer.email} start: HTTP ${started.status} ${short(started.body)}`);
  const session = started.body.session;
  const begun = Date.now();
  const finish = async () => {
    let from = 0;
    while (from < seconds) {
      await sleep(2_000);
      // Never ahead of the clock: the server refuses faster than real time.
      const to = Math.min(seconds, Math.floor((Date.now() - begun) / 1_000));
      if (to <= from) continue;
      const progress = await call("POST", `/api/watch/sessions/${session.id}/progress`, viewer, {
        fromSeconds: from,
        toSeconds: to,
        reportedAt: new Date().toISOString(),
      });
      if (progress.status >= 400)
        throw new Error(
          `${viewer.email} progress ${from}-${to}: HTTP ${progress.status} ${short(progress.body)}`,
        );
      from = to;
    }
    return call("POST", `/api/watch/sessions/${session.id}/complete`, viewer, {});
  };
  return { session, finish };
}

const campaignAlerts = async (owner, biz, campaignId) =>
  (await ok(await call("GET", `${billing(biz)}/alerts`, owner), "alerts")).alerts.filter(
    (a) => a.kind === "campaign" && a.subjectId === campaignId,
  );

async function devInbox() {
  const res = await fetch(`${API}/api/dev/inbox`);
  return res.status === 200 ? (await res.json()).entries : null;
}

async function stepBudgetAlerts() {
  const { owner, biz } = await ownerAndBrand();
  const { campaignId, title, reward, budget, seconds } = await createBudgetShort(owner, biz);
  const viewers = ["viewer", "adult", "guardian", "charity1", "charity2", "member", "finance"].map(
    (who) => demo(who),
  );
  const alertsNow = () => campaignAlerts(owner, biz, campaignId);

  // Used means held or paid: a session's hold reserves its reward at the start.
  let paidViews = 0;
  const earn = async () => {
    for (;;) {
      const email = viewers.shift();
      if (!email) throw new Error("ran out of demo viewers");
      const view = await startView(await login(email), campaignId, seconds);
      if (view.session.nonEarning) {
        // Their own caps (not the campaign's): skip to the next viewer.
        note(`${email} was not admitted as earning, skipped`, view.session.nonEarningReason);
        continue;
      }
      const done = await view.finish();
      paidViews += 1;
      expect(
        done.status === 201 && done.body.granted === true && done.body.pendingPoints === reward,
        `view ${paidViews} paid ${reward} points`,
        `${email}: HTTP ${done.status}, ${short(done.body)}`,
      );
      return;
    }
  };
  const awaitAlert = async (pct) => {
    const alert = await until(
      async () => (await alertsNow()).find((a) => a.thresholdPct === pct) ?? null,
      ALERT_WAIT_MS,
      5_000,
    );
    if (!alert) {
      fail(
        `the ${pct}% alert`,
        `none within ${ALERT_WAIT_MS / 60_000} min (the API sweeps every ${ALERT_SWEEP_MS / 60_000} min)`,
      );
      return null;
    }
    expect(
      alert.totalPoints === budget &&
        alert.usedPoints * 100 >= pct * budget &&
        alert.usedPoints <= paidViews * reward &&
        alert.campaignTitle === title,
      `the ${pct}% alert is right`,
      `${alert.id}: ${alert.usedPoints} of ${alert.totalPoints} points used, "${alert.campaignTitle}"`,
    );
    return alert;
  };
  const only = async (pcts, what) => {
    const got = (await alertsNow()).map((a) => a.thresholdPct).sort((a, b) => a - b);
    expect(got.join() === pcts.join(), what, `campaign alerts: ${got.join(", ") || "none"}`);
  };

  await earn();
  await earn();
  await only([], "no alert at 40% used (two views)");
  await earn(); // 60%: past 50%, short of 80%
  const a50 = await awaitAlert(50);
  await only([50], "at 60% used only the 50% alert exists");
  await earn(); // 80%
  const a80 = await awaitAlert(80);
  await only([50, 80], "at 80% used the 50% and 80% alerts exist, not 100%");
  await earn(); // 100%
  const a100 = await awaitAlert(100);

  // The budget is spent: the next viewer is told up front, nothing errors, nothing is paid.
  const last = viewers.shift();
  if (!last) throw new Error("no demo viewer left for the view after the budget");
  const refused = await startView(await login(last), campaignId, seconds);
  expect(
    refused.session.nonEarning === true && refused.session.nonEarningReason === BUDGET_REFUSAL,
    "at 100% the next view starts as non-earning, and says why",
    `${last}: nonEarning ${refused.session.nonEarning}, "${refused.session.nonEarningReason}" (the ledger's campaign_cap_reached)`,
  );
  const unpaid = await refused.finish();
  expect(
    unpaid.status === 201 && unpaid.body.granted === false && unpaid.body.pendingPoints === 0,
    "completing that view pays nothing and does not error",
    `HTTP ${unpaid.status}, ${short(unpaid.body)}`,
  );

  // Each alert once: let a whole sweep pass, then read them again.
  say(
    `-- waiting ${ALERT_SWEEP_MS / 60_000} min for another sweep, to see nothing is raised twice --`,
  );
  await sleep(ALERT_SWEEP_MS + 15_000);
  await only([50, 80, 100], "after another sweep each campaign alert still exists exactly once");

  // Email: staging sends real mail only to its allow-list; the rest lands in the dev inbox.
  const inbox = await devInbox();
  if (inbox === null) {
    note(
      "the dev inbox is not readable here",
      "GET /api/dev/inbox did not answer 200: emails not checked",
    );
    return;
  }
  for (const alert of [a50, a80, a100]) {
    if (!alert) continue;
    const to = inbox
      .filter((m) => m.category === "budget_alert" && m.metadata?.alertId === alert.id)
      .map((m) => m.recipient)
      .sort();
    note(
      `emails for the ${alert.thresholdPct}% alert`,
      `${to.length} in the dev inbox: ${to.join(", ") || "none"}`,
    );
    expect(
      to.join() === [demo("finance"), demo("owner")].sort().join(),
      `the ${alert.thresholdPct}% alert was emailed once each to the owner and finance, not the marketer`,
      to.length === 0
        ? "nothing in the newest 50 messages (a recipient on the live allow-list would have had real mail instead)"
        : "",
    );
  }
  note(
    "left behind",
    `campaign ${campaignId} stays live but spent; its ${budget} points went to ${ALERT_VIEWS} demo viewers`,
  );
}

// ---------------------------------------------------------------- runner

const STEPS = {
  purchase: stepPurchase,
  declined: stepDeclined,
  "three-ds": stepThreeDs,
  boost: stepBoost,
  manual: stepManual,
  auction: stepAuction,
  payout: stepPayout,
  "auction-settled": stepAuctionSettled,
  "payout-sim": stepPayoutSim,
  "budget-alerts": stepBudgetAlerts,
};
const ORDER = ["purchase", "declined", "three-ds", "boost", "manual", "auction", "payout"];

async function run(name, args) {
  const failedBefore = failures;
  const pendingBefore = pendings;
  say(`\n=== ${name} (run ${RUN}) ===`);
  try {
    await STEPS[name](args);
    if (!defer) await checkInvoices();
  } catch (error) {
    fail(`${name} stopped`, error instanceof Error ? error.message : String(error));
  }
  const verdict =
    failures > failedBefore
      ? "FAIL"
      : pendings > pendingBefore
        ? "WAIT (not failed, see above)"
        : "PASS";
  say(`=== ${name}: ${verdict} ===`);
}

const [step, ...rest] = process.argv.slice(2);
if (step === "all") {
  defer = true;
  for (const name of ORDER) await run(name, rest);
  say("\n=== invoices (all steps) ===");
  try {
    await checkInvoices();
  } catch (error) {
    fail("invoices stopped", error instanceof Error ? error.message : String(error));
  }
  say(
    "\nFollow-ups, if the lines above printed them: run the auction SQL, then `auction-settled ...`; run the payout SQL, then `payout-sim ...`.",
  );
} else if (step && STEPS[step]) {
  await run(step, rest);
} else {
  console.error(
    `usage: check-5.1.f-payments.mjs <${[...ORDER, "all", "auction-settled", "payout-sim", "budget-alerts"].join("|")}>`,
  );
  process.exitCode = 2;
}
say(
  `\n${failures === 0 ? "RESULT: no failures" : `RESULT: ${failures} failure(s)`}${pendings ? `, ${pendings} waiting` : ""}`,
);
process.exitCode = failures === 0 ? 0 : 1;
