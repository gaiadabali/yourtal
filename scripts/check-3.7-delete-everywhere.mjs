#!/usr/bin/env node
// 3.7.b / C1 (docs/29-deletion-across-apps.md §12): one deletion reaches every app, on staging.
// Fresh `.test` accounts only, made by this script; nothing seeded is touched. Writes go only
// through the apps' public APIs and screens; the database is read through `ssh <host>` in
// READ ONLY transactions. Prints each step's HTTP status and row counts before and after.
// No password, session token or full `sub` is printed (subs are shown as an 8-char prefix).
//
//   node scripts/check-3.7-delete-everywhere.mjs [a|b|ftr|all]   (default all; a and b need
//   separate hours: YourTal allows 5 sign-ups an hour per address)
//   node scripts/check-3.7-delete-everywhere.mjs cleanup <email>…   (leftovers of a broken run)
//
// Phase A: A deletes in Me. B is A's co-worker (B's workspace, A invited as member).
// Phase B: C removes SnapApp in Me → Linked apps; D (only owner) invites admin E.
// ftr:     FTR's endpoint is configured and fetches YourTal's JWKS (no linked FTR account
//          can exist while its sign-in switch is off, so no signed event can reach it).
// Phase C (teens) waits for 3.10.
//
// Env: CHECK_YT (https://yourtal.gaiada.com), CHECK_SNAP_WEB (https://snap-apps.gaiada.com),
// CHECK_SNAP_API (https://snap-apps-api.gaiada.com), CHECK_FTR_EVENTS
// (https://freetaxreturns.com.au/api/yourtal/events), CHECK_SSH (helios), CHECK_WAIT_MIN (5),
// CHECK_PLAYWRIGHT_FROM (a package.json whose node_modules has @playwright/test; default
// apps/web/package.json of this checkout), CHECK_HEADED=1 to watch, CHECK_SHOTS (screenshot dir).
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const YT = process.env.CHECK_YT ?? "https://yourtal.gaiada.com";
const SNAP_WEB = process.env.CHECK_SNAP_WEB ?? "https://snap-apps.gaiada.com";
const SNAP_API = process.env.CHECK_SNAP_API ?? "https://snap-apps-api.gaiada.com";
const FTR_EVENTS = process.env.CHECK_FTR_EVENTS ?? "https://freetaxreturns.com.au/api/yourtal/events";
const SSH = process.env.CHECK_SSH ?? "helios";
const WAIT_MS = Number(process.env.CHECK_WAIT_MIN ?? 5) * 60_000;
const SHOTS = process.env.CHECK_SHOTS ?? join(tmpdir(), "check-3.7-shots");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(
  process.env.CHECK_PLAYWRIGHT_FROM ?? join(repo, "apps/web/package.json"),
)("@playwright/test");

const RUN = `${new Date().toISOString().slice(5, 10).replace("-", "")}-${randomUUID().slice(0, 6)}`;
const PASSWORD = `C1-${randomUUID()}`; // per run, never printed
const results = [];
const t0 = Date.now();
const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;
const log = (...a) => console.log(`[${secs()}]`, ...a);
function check(name, ok, evidence = "") {
  results.push({ name, ok });
  console.log(`[${secs()}] ${ok ? "PASS" : "FAIL"}  ${name}${evidence ? `  — ${evidence}` : ""}`);
  return ok;
}
const short = (s) => (s ? `${s.slice(0, 8)}…` : String(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Read-only SQL on the box ───────────────────────────────────────────────────────────────
const PSQL = {
  yt: "docker exec -i yourtal-postgres psql -U yourtal -d yourtal -XAt -F '|' -v ON_ERROR_STOP=1",
  snap: "docker exec -i snap-postgres psql -U postgres -d snapapps -XAt -F '|' -v ON_ERROR_STOP=1",
};
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
function sql(db, query) {
  const out = execFileSync("ssh", [SSH, PSQL[db]], {
    input: `begin read only;\n${query};\nrollback;\n`,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((l) => l && l !== "BEGIN" && l !== "ROLLBACK")
    .map((l) => l.split("|"));
}
const one = (db, q) => sql(db, q)[0]?.[0] ?? null;
const num = (db, q) => Number(one(db, q));
const storageHas = (dir) =>
  execFileSync("ssh", [SSH, `docker exec snap-apps-worker-1 sh -c 'test -d "$STORAGE_DIR"/${dir} && echo yes || echo no'`], {
    encoding: "utf8",
  }).trim() === "yes";

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────
async function call(base, path, { method = "GET", token, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined && raw === undefined) h["content-type"] = "application/json";
  if (base === YT && method !== "GET") h["idempotency-key"] = randomUUID();
  const res = await fetch(base + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function until(what, fn, ms = WAIT_MS) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) { log(`timed out waiting for ${what}`); return null; }
    await sleep(5000);
  }
}

// ── YourTal accounts ────────────────────────────────────────────────────────────────────────
async function newAccount(tag) {
  const email = `qa-c1-${RUN}-${tag}@example.test`;
  const register = () => call(YT, "/api/auth/register", {
    method: "POST",
    body: { email, password: PASSWORD, region: "AU", locale: "en-AU", displayName: `QA C1 ${tag.toUpperCase()}`, dateOfBirth: "1990-01-01", timezone: "Australia/Sydney" },
  });
  let reg = await register();
  // YourTal allows 5 sign-ups per address per rolling hour; wait each one out.
  while (reg.status === 429 && (reg.json?.retryAfterSeconds ?? 9e9) <= 3600) {
    log(`${tag}: sign-up rate-limited, waiting ${reg.json.retryAfterSeconds}s`);
    await sleep((reg.json.retryAfterSeconds + 5) * 1000);
    reg = await register();
  }
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`register ${tag}: ${reg.status} ${reg.text}`);
  const vt = await until(`verification mail for ${tag}`, () =>
    one("yt", `select metadata->>'token' from platform.sim_outbox where recipient = ${lit(email)} and category = 'email_verification' order by created_at desc limit 1`), 60_000);
  const v = await call(YT, "/api/auth/email/verify/confirm", { method: "POST", body: { token: vt } });
  log(`${tag}: registered ${email} (register ${reg.status}, verify ${v.status})`);
  return { tag, email, userId: reg.json.userId, ytToken: reg.json.token };
}

// ── Browser: SnapApp → YourTal → SnapApp, and YourTal's Me ─────────────────────────────────
let browser;
async function page() {
  browser ??= await chromium.launch({ headless: process.env.CHECK_HEADED !== "1" });
  const ctx = await browser.newContext();
  return { ctx, p: await ctx.newPage() };
}
async function shot(p, name) {
  mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: join(SHOTS, `${RUN}-${name}.png`), fullPage: true }).catch(() => {});
}
// YourTal allows 30 logins per address per 15 minutes; a run is ~15, so back off on a 429.
async function ytLogin(p, who) {
  for (let i = 0; ; i++) {
    await p.fill("input[name=email]", who.email);
    await p.fill("input[name=password]", PASSWORD);
    await p.locator("button[type=submit]").first().click();
    await p.waitForURL((u) => !/\/login$/.test(new URL(String(u)).pathname) || /error=/.test(String(u)), { timeout: 30_000 });
    if (!/error=http_429/.test(p.url()) || i >= 16) break;
    log(`${who.tag}: login rate-limited (429), waiting 60s`);
    await sleep(60_000);
  }
  if (/\/login/.test(new URL(p.url()).pathname)) throw new Error(`${who.tag}: login failed (${new URL(p.url()).search})`);
  if (/\/passkey/.test(p.url())) {
    await p.getByRole("button", { name: "Not now" }).or(p.getByRole("link", { name: "Not now" })).first().click();
    await p.waitForURL((u) => !/\/passkey/.test(String(u)), { timeout: 30_000 });
  }
}
/** Signs `who` in to SnapApp with YourTal. Returns the SnapApp session token and what the consent step showed. */
async function snapSignIn(who, label) {
  const { ctx, p } = await page();
  await p.goto(`${SNAP_WEB}/auth/yourtal`);
  await p.waitForLoadState("networkidle");
  await p.getByRole("link", { name: "Sign in", exact: true }).click();
  await p.waitForURL(/\/login/);
  await ytLogin(p, who);
  let consent = false;
  if (/\/connect\//.test(p.url())) {
    await p.waitForLoadState("networkidle");
    const continueBtn = p.getByRole("button", { name: "Continue", exact: true });
    consent = await continueBtn.isVisible().catch(() => false);
    await shot(p, `${label}-consent`);
    if (consent) await continueBtn.click();
  }
  await p.waitForURL((u) => String(u).startsWith(SNAP_WEB), { timeout: 45_000 });
  await p.waitForLoadState("networkidle");
  await shot(p, `${label}-snap`);
  const token = (await ctx.cookies(SNAP_WEB)).find((c) => c.name === "snap_session")?.value;
  const landed = new URL(p.url()).pathname;
  await ctx.close();
  if (!token) throw new Error(`${label}: no snap_session after sign-in (landed on ${landed})`);
  log(`${label}: signed in to SnapApp via YourTal (consent screen shown: ${consent}, landed ${landed})`);
  return { token, consent };
}
/** Me → Delete my account, as the person does it. */
async function deleteInMe(who) {
  const { ctx, p } = await page();
  await p.goto(`${YT}/login`);
  await ytLogin(p, who);
  await p.goto(`${YT}/me`);
  await p.waitForLoadState("networkidle");
  const actions = [];
  p.on("response", (r) => { if (r.request().method() === "POST" && r.url().startsWith(`${YT}/me`)) actions.push(r.status()); });
  await p.getByRole("button", { name: "Delete my account" }).last().click();
  const dialog = p.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await shot(p, `${who.tag}-delete-dialog`);
  await dialog.getByRole("button", { name: "Delete my account" }).click();
  await p.waitForURL((u) => !/\/me$/.test(new URL(String(u)).pathname), { timeout: 30_000 }).catch(() => {});
  await p.waitForLoadState("networkidle");
  await shot(p, `${who.tag}-after-delete`);
  const where = new URL(p.url()).pathname;
  await ctx.close();
  return { actions, where };
}
/** Me → Apps you sign in to with YourTal → Remove SnapApp. */
async function removeSnapInMe(who) {
  const { ctx, p } = await page();
  await p.goto(`${YT}/login`);
  await ytLogin(p, who);
  await p.goto(`${YT}/me`);
  await p.waitForLoadState("networkidle");
  const actions = [];
  p.on("response", (r) => { if (r.request().method() === "POST" && r.url().startsWith(`${YT}/me`)) actions.push(r.status()); });
  await p.getByRole("button", { name: "Remove SnapApp" }).click();
  const dialog = p.getByRole("dialog");
  const body = (await dialog.innerText()).replace(/\s+/g, " ");
  await shot(p, `${who.tag}-remove-dialog`);
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await p.getByRole("button", { name: "Remove SnapApp" }).waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  await shot(p, `${who.tag}-after-remove`);
  const stillListed = await p.getByRole("button", { name: "Remove SnapApp" }).count();
  await ctx.close();
  return { actions, body, stillListed };
}

// ── SnapApp data, through its API ───────────────────────────────────────────────────────────
// A 1x1 PNG; the capture is what matters, not what extraction makes of it.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function onboard(token, name) {
  const r = await call(SNAP_API, "/v1/workspaces/onboarding", { method: "POST", token, body: { workspaceName: name, kind: "personal" } });
  const ws = r.json?.workspaces?.[0]?.id ?? r.json?.workspace?.id ?? (await call(SNAP_API, "/v1/workspaces", { token })).json?.[0]?.id;
  log(`onboarding "${name}": ${r.status}, workspace ${ws}`);
  return ws;
}
async function capture(token, ws) {
  const headers = { "x-workspace-id": ws };
  const sha256 = createHash("sha256").update(PNG).digest("hex");
  const c = await call(SNAP_API, "/v1/captures", { method: "POST", token, headers, body: { pages: [{ sha256, mimeType: "image/png", byteSize: PNG.length }] } });
  const url = c.json?.uploads?.[0]?.uploadUrl;
  const u = url ? await call(SNAP_API, url, { method: "PUT", token, headers: { ...headers, "content-type": "image/png" }, raw: PNG }) : { status: "-" };
  log(`capture in ${ws}: POST ${c.status}, PUT ${u.status}`);
  return c.json?.captureId ?? c.json?.capture?.id ?? c.json?.id ?? null;
}
const session = async (token) => (await call(SNAP_API, "/v1/auth/session", { token })).status;

// ── Row snapshots ───────────────────────────────────────────────────────────────────────────
const subOf = (userId) => one("yt", `select sub from oidc.subject where user_id = ${lit(userId)} limit 1`);
function ytRows(userId) {
  const r = sql("yt", `select
    (select count(*) from oidc.subject where user_id = ${lit(userId)}),
    (select count(*) from oidc.app_consent where user_id = ${lit(userId)}),
    (select count(*) from oidc.app_consent where user_id = ${lit(userId)} and ended_at is null),
    (select count(*) from oidc.sign_in_log where user_id = ${lit(userId)}),
    (select count(*) from identity.consent_record where user_id = ${lit(userId)}),
    (select count(*) from identity.consent_record where user_id = ${lit(userId)} and purpose = 'sister_app_profile_sharing'),
    (select count(*) from identity.user_profile where user_id = ${lit(userId)})`)[0];
  const [subject, consents, liveConsents, signInLog, consentRecords, appConsentRecords, profile] = r.map(Number);
  return { subject, consents, liveConsents, signInLog, consentRecords, appConsentRecords, profile };
}
const outbox = (sub) =>
  sql("yt", `select jti, client_id, event_type, payload::text, attempts, delivered_at is not null, failed_at is not null, coalesce(last_error,''),
    round(extract(epoch from (delivered_at - iat)))::text from oidc.event_outbox where sub = ${lit(sub)} order by iat`)
    .map(([jti, client, type, payload, attempts, delivered, failed, error, lag]) =>
      ({ jti, client, type, payload, attempts: Number(attempts), delivered: delivered === "t", failed: failed === "t", error, lag }));
function snapRows(sub, email, wsIds) {
  const ws = wsIds.filter(Boolean).map(lit).join(",") || "NULL";
  const u = `(select id from users where subject = ${lit(`yourtal|${sub}`)})`;
  const [users, liveSessions, memberships, tenants, captures, erased, mail] = sql("snap", `select
    (select count(*) from users where subject = ${lit(`yourtal|${sub}`)}),
    (select count(*) from user_sessions where user_id in ${u} and revoked_at is null and expires_at > now()),
    (select count(*) from memberships where user_id in ${u}),
    (select count(*) from tenants where id in (${ws})),
    (select count(*) from captures where tenant_id in (${ws})),
    (select count(*) from yourtal_erased_subjects where sub = ${lit(sub)}),
    (select count(*) from mail_deliveries where recipient = ${lit(email)})`)[0].map(Number);
  return { users, liveSessions, memberships, tenants, captures, erased, mail };
}
const jobsFor = (jti) =>
  sql("snap", `select kind, attempts, completed_at is not null, coalesce(last_error,'') from jobs where id = ${lit(jti)}`)
    .map(([kind, attempts, done, error]) => ({ kind, attempts: Number(attempts), done: done === "t", error }));
const purgeJobs = (ws) =>
  sql("snap", `select attempts, completed_at is not null, coalesce(last_error,'') from jobs where kind = 'storage_purge' and payload->>'tenantId' = ${lit(ws)}`)
    .map(([attempts, done, error]) => ({ attempts: Number(attempts), done: done === "t", error }));
const show = (label, o) => log(`${label}: ${JSON.stringify(o)}`);

// ── Phase A ─────────────────────────────────────────────────────────────────────────────────
async function phaseA() {
  console.log(`\n=== Phase A: an adult deletes (run ${RUN}) ===`);
  const A = await newAccount("a");
  const B = await newAccount("b");
  const a = await snapSignIn(A, "a");
  const b = await snapSignIn(B, "b");
  check("A: first SnapApp sign-in goes through the consent screen", a.consent);
  const wsA = await onboard(a.token, `C1 ${RUN} A home`);
  const wsB = await onboard(b.token, `C1 ${RUN} B shared`);
  await capture(a.token, wsA);
  // A as a member of B's workspace (docs/29 §12). A new workspace is on the Free plan (1 seat).
  const inv = await call(SNAP_API, `/v1/workspaces/${wsB}/invitations`, { method: "POST", token: b.token, headers: { "x-workspace-id": wsB }, body: { email: A.email, role: "member" } });
  log(`B invites A to B's workspace: ${inv.status} ${inv.json?.message ?? ""}`);
  let shared = false;
  if (inv.status === 201 || inv.status === 200) {
    const acc = await call(SNAP_API, "/v1/workspaces/invitations/accept", { method: "POST", token: a.token, body: { token: inv.json.token } });
    log(`A accepts: ${acc.status}`);
    shared = acc.status === 200 && (await capture(a.token, wsB)) !== null;
  } else {
    log("UNTESTABLE on staging: B's workspace has one seat (Free plan); a plan needs a staff grant. Shared-workspace sub-check skipped.");
  }
  A.sub = subOf(A.userId);
  check("A has a SnapApp sub at YourTal", !!A.sub, `sub ${short(A.sub)}`);
  check("A's SnapApp token works before (200)", (await session(a.token)) === 200);
  const ytBefore = ytRows(A.userId);
  const snapBefore = snapRows(A.sub, A.email, [wsA]);
  const dirBefore = storageHas(wsA);
  show("YourTal rows for A, before", ytBefore);
  show("SnapApp rows for A, before", { ...snapBefore, storageDir: dirBefore });
  check("A's outbox is empty before", outbox(A.sub).length === 0);

  log("A deletes the account in Me…");
  const del = await deleteInMe(A);
  log(`delete: server-action statuses ${JSON.stringify(del.actions)}, landed on ${del.where}`);
  const tDel = Date.now();
  const ytApi = await call(YT, "/api/me", { token: A.ytToken });
  check("A's YourTal session is gone (GET /api/me)", ytApi.status === 401, `${ytApi.status}`);

  const rows = await until("A's outbox row delivered", () => { const r = outbox(A.sub); return r.length && r.every((x) => x.delivered || x.failed) ? r : null; });
  for (const r of rows ?? outbox(A.sub)) show("outbox row", { ...r, jti: short(r.jti) });
  const delivered = (rows ?? []).filter((r) => r.type.endsWith(":account-deleted") && r.client === "snapapp-staging-server" && r.delivered);
  check("one account-deleted row to snapapp-staging-server, delivered", delivered.length === 1,
    `${rows?.length ?? 0} row(s), ${Math.round((Date.now() - tDel) / 1000)}s after delete`);
  const ytAfter = ytRows(A.userId);
  show("YourTal rows for A, after", ytAfter);
  check("no oidc.subject / app_consent / sign_in_log rows left for A", ytAfter.subject + ytAfter.consents + ytAfter.signInLog === 0);
  check("A's consent records are kept", ytAfter.consentRecords > 0 && ytAfter.consentRecords >= ytBefore.consentRecords,
    `${ytBefore.consentRecords} → ${ytAfter.consentRecords}`);
  check("A's YourTal profile is erased", ytAfter.profile === 0);
  const tok401 = await until("A's SnapApp token to answer 401", async () => ((await session(a.token)) === 401 ? true : null), 120_000);
  check("A's old SnapApp token answers 401", !!tok401);

  const jti = delivered[0]?.jti;
  const job = jti ? await until("SnapApp yourtal_event job done", () => { const j = jobsFor(jti); return j[0]?.done ? j : null; }) : null;
  show("SnapApp job (id = jti)", job ?? (jti ? jobsFor(jti) : "no jti"));
  check("SnapApp yourtal_event job completed", job?.[0]?.kind === "yourtal_event" && job[0].done);
  const purge = await until("storage_purge for A's workspace", () => { const p = purgeJobs(wsA); return p[0]?.done ? p : null; });
  show("storage_purge job", purge ?? purgeJobs(wsA));
  check("storage_purge for A's workspace completed", !!purge);
  const snapAfter = snapRows(A.sub, A.email, [wsA]);
  const dirAfter = storageHas(wsA);
  show("SnapApp rows for A, after", { ...snapAfter, storageDir: dirAfter });
  check("SnapApp user gone", snapBefore.users === 1 && snapAfter.users === 0);
  check("A's workspace and its captures gone", snapBefore.tenants === 1 && snapAfter.tenants === 0 && snapAfter.captures === 0,
    `tenants ${snapBefore.tenants} → ${snapAfter.tenants}, captures ${snapBefore.captures} → ${snapAfter.captures}`);
  check("A's storage directory purged", dirBefore && !dirAfter, `${dirBefore} → ${dirAfter}`);
  check("sub on yourtal_erased_subjects", snapAfter.erased === 1);
  check("no mail_deliveries to A", snapAfter.mail === 0);
  check("B is untouched (session 200, workspace kept)", (await session(b.token)) === 200 && snapRows(subOf(B.userId), B.email, [wsB]).tenants === 1);
  if (!shared) log("NOTE: 'B's workspace keeps A's receipt with uploaded_by NULL' not checked (seat limit above).");

  log("A registers again with the same email…");
  const A2 = await newAccount("a").catch((e) => ({ error: e.message }));
  if (A2.error) { check("A can register again with the same email", false, A2.error); return; }
  const a2 = await snapSignIn(A2, "a2");
  const s2 = (await call(SNAP_API, "/v1/auth/session", { token: a2.token })).json;
  A2.sub = subOf(A2.userId);
  check("A's new account gets a new, empty SnapApp account", A2.sub !== A.sub && a2.consent && (s2?.workspaces?.length ?? -1) === 0,
    `new sub ${short(A2.sub)} vs ${short(A.sub)}, workspaces ${s2?.workspaces?.length}`);
  return [A2, B];
}

// ── Phase B ─────────────────────────────────────────────────────────────────────────────────
async function phaseB() {
  console.log(`\n=== Phase B: ended access, and an only owner deletes (run ${RUN}) ===`);
  const C = await newAccount("c");
  const c = await snapSignIn(C, "c");
  const wsC = await onboard(c.token, `C1 ${RUN} C home`);
  await capture(c.token, wsC);
  C.sub = subOf(C.userId);
  const before = snapRows(C.sub, C.email, [wsC]);
  const dirBefore = storageHas(wsC);
  show("SnapApp rows for C, before", { ...before, storageDir: dirBefore });
  show("YourTal rows for C, before", ytRows(C.userId));

  const rm = await removeSnapInMe(C);
  log(`remove: server-action statuses ${JSON.stringify(rm.actions)}; dialog: "${rm.body.slice(0, 160)}…"`);
  check("SnapApp no longer listed in Me after Remove", rm.stillListed === 0);
  const tRm = Date.now();
  const rows = await until("C's access-ended row delivered", () => { const r = outbox(C.sub); return r.length && r.every((x) => x.delivered || x.failed) ? r : null; });
  for (const r of rows ?? outbox(C.sub)) show("outbox row", { ...r, jti: short(r.jti) });
  const row = rows?.find((r) => r.type.endsWith(":access-ended"));
  check("one access-ended row (user_removed, erase_data false), delivered", rows?.length === 1 && !!row?.delivered &&
    /user_removed/.test(row.payload) && /"erase_data":\s*false/.test(row.payload), `${Math.round((Date.now() - tRm) / 1000)}s after remove`);
  const ytC = ytRows(C.userId);
  show("YourTal rows for C, after remove", ytC);
  check("C's app consent ended, sub kept", ytC.liveConsents === 0 && ytC.subject === 1);
  check("C's old SnapApp token answers 401", !!(await until("C's token 401", async () => ((await session(c.token)) === 401 ? true : null), 120_000)));
  const job = row ? await until("C's job done", () => { const j = jobsFor(row.jti); return j[0]?.done ? j : null; }) : null;
  check("SnapApp yourtal_event job completed", !!job);
  const after = snapRows(C.sub, C.email, [wsC]);
  const dirAfter = storageHas(wsC);
  show("SnapApp rows for C, after", { ...after, storageDir: dirAfter });
  check("C's data kept (user, workspace, captures, files), sub not erased",
    after.users === 1 && after.tenants === 1 && after.captures === before.captures && dirAfter && after.erased === 0);

  const again = await snapSignIn(C, "c-again");
  const s = (await call(SNAP_API, "/v1/auth/session", { token: again.token })).json;
  check("C signs in again: consent screen, same account and workspace", again.consent && (s?.workspaces ?? []).some((w) => w.id === wsC));

  // D, only owner of a workspace with admin E, deletes (docs/29 §12).
  // E's account is made only if the invitation can be sent (sign-ups are rate-limited).
  const D = await newAccount("d");
  const d = await snapSignIn(D, "d");
  const wsD = await onboard(d.token, `C1 ${RUN} D shared`);
  const eEmail = `qa-c1-${RUN}-e@example.test`;
  const inv = await call(SNAP_API, `/v1/workspaces/${wsD}/invitations`, { method: "POST", token: d.token, headers: { "x-workspace-id": wsD }, body: { email: eEmail, role: "admin" } });
  log(`D invites E as admin: ${inv.status} ${inv.json?.message ?? ""}`);
  if (inv.status !== 201 && inv.status !== 200) {
    log("UNTESTABLE on staging: one seat on the Free plan; the D/E handover needs a staff plan grant.");
  } else {
    log("NOTE: the invitation went through; the E accept + D delete + handover steps are not scripted yet.");
  }
  return [C, D];
}

// ── FTR ─────────────────────────────────────────────────────────────────────────────────────
async function ftr() {
  console.log("\n=== FTR: events endpoint, sign-in switch off ===");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwks = (await call(YT, "/oidc/jwks")).json;
  const kid = jwks?.keys?.[0]?.kid;
  const body = b64({ iss: `${YT}/oidc`, aud: "ftr-web", iat: Math.floor(Date.now() / 1000), jti: randomUUID() });
  const post = (header) => call("", FTR_EVENTS, { method: "POST", headers: { "content-type": "application/secevent+jwt" }, raw: `${b64(header)}.${body}.${b64({ x: 1 })}` });
  const unknownKid = await post({ typ: "secevent+jwt", alg: "RS256", kid: `c1-unknown-${RUN}` });
  check("FTR fetches YourTal's JWKS: an unknown kid gets 400 invalid_key", unknownKid.status === 400 && unknownKid.json?.err === "invalid_key", `${unknownKid.status} ${unknownKid.text}`);
  const forged = await post({ typ: "secevent+jwt", alg: "RS256", kid });
  check("FTR refuses a forged signature under YourTal's kid: 400 authentication_failed", forged.status === 400 && forged.json?.err === "authentication_failed", `${forged.status} ${forged.text}`);
  log("UNTESTABLE: a correctly signed event for an unknown sub (202) needs a YourTal-signed SET; YourTal sends FTR one only for a person with an FTR sub, which needs FTR's sign-in switch (L4).");
}

// ── Cleanup: each leftover account deletes itself through the public API ───────────────────
// A password reset (its link read from the dev inbox) gives a session, so this also clears
// accounts from an interrupted run: `cleanup <email>…`.
async function deleteByEmail(email, password) {
  if (password) {
    const login = await call(YT, "/api/auth/login", { method: "POST", body: { email, password } });
    if (login.json?.token) {
      const del = await call(YT, "/api/me", { method: "DELETE", token: login.json.token });
      return log(`cleanup ${email}: login ${login.status}, DELETE /api/me ${del.status}`);
    }
  }
  // Only 3 resets an hour per address: for a broken run's leftovers only.
  const since = one("yt", "select now()");
  const req = await call(YT, "/api/auth/password/reset/request", { method: "POST", body: { email } });
  const token = await until(`reset mail for ${email}`, () =>
    one("yt", `select metadata->>'token' from platform.sim_outbox where recipient = ${lit(email)} and created_at >= ${lit(since)} and metadata ? 'token' order by created_at desc limit 1`), 60_000);
  const conf = token ? await call(YT, "/api/auth/password/reset/confirm", { method: "POST", body: { token, newPassword: `C1-${randomUUID()}` } }) : req;
  const del = conf.json?.token ? await call(YT, "/api/me", { method: "DELETE", token: conf.json.token }) : conf;
  log(`cleanup ${email}: reset ${req.status}/${conf.status}, DELETE /api/me ${del.status}`);
}

const what = process.argv[2] ?? "all";
if (what === "cleanup") {
  for (const email of process.argv.slice(3)) await deleteByEmail(email);
  process.exit(0);
}
const leftovers = [];
try {
  if (what === "a" || what === "all") leftovers.push(...((await phaseA()) ?? []));
  if (what === "b" || what === "all") leftovers.push(...((await phaseB()) ?? []));
  if (what === "ftr" || what === "all") await ftr();
} catch (error) {
  check("run finished without an exception", false, error.stack ?? String(error));
} finally {
  await browser?.close();
  if (process.env.CHECK_KEEP !== "1") for (const who of leftovers) if (who?.email) await deleteByEmail(who.email, PASSWORD);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (run ${RUN}, screenshots in ${SHOTS})`);
for (const f of failed) console.log(`  FAIL ${f.name}`);
process.exit(failed.length ? 1 : 0);
