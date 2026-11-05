// Shared by the group staging checks (check-3.7-*, check-4.8-*): fresh `.test` accounts,
// read-only SQL on Helios over ssh, sign-in through YourTal in Chromium, and cleanup.
// Never prints a password, session token, assertion or full `sub` (subs: an 8-char prefix).
//
// Env: CHECK_YT, CHECK_SNAP_WEB, CHECK_SNAP_API, CHECK_FTR (https://freetaxreturns.com.au),
// CHECK_SSH (helios), CHECK_WAIT_MIN (5), CHECK_PLAYWRIGHT_FROM (a package.json whose
// node_modules has @playwright/test), CHECK_HEADED=1, CHECK_SHOTS (screenshot dir).
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const YT = process.env.CHECK_YT ?? "https://yourtal.gaiada.com";
export const SNAP_WEB = process.env.CHECK_SNAP_WEB ?? "https://snap-apps.gaiada.com";
export const SNAP_API = process.env.CHECK_SNAP_API ?? "https://snap-apps-api.gaiada.com";
export const FTR = process.env.CHECK_FTR ?? "https://freetaxreturns.com.au";
const SSH = process.env.CHECK_SSH ?? "helios";
export const WAIT_MS = Number(process.env.CHECK_WAIT_MIN ?? 5) * 60_000;
export const SHOTS = process.env.CHECK_SHOTS ?? join(tmpdir(), "check-shots");
const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = createRequire(
  process.env.CHECK_PLAYWRIGHT_FROM ?? join(repo, "apps/web/package.json"),
)("@playwright/test");

export const RUN = `${new Date().toISOString().slice(5, 10).replace("-", "")}-${randomUUID().slice(0, 6)}`;
export const PASSWORD = `C1-${randomUUID()}`; // per run, never printed
const results = [];
const t0 = Date.now();
const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;
export const log = (...a) => console.log(`[${secs()}]`, ...a);
export const show = (label, o) => log(`${label}: ${JSON.stringify(o)}`);
export const short = (s) => (s ? `${s.slice(0, 8)}…` : String(s));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function check(name, ok, evidence = "") {
  results.push({ name, ok });
  console.log(`[${secs()}] ${ok ? "PASS" : "FAIL"}  ${name}${evidence ? `  — ${evidence}` : ""}`);
  return ok;
}
/** Prints the tally and returns the exit code. */
export function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (run ${RUN}, screenshots in ${SHOTS})`);
  for (const f of failed) console.log(`  FAIL ${f.name}`);
  return failed.length ? 1 : 0;
}

// ── Read-only SQL on the box ───────────────────────────────────────────────────────────────
const PSQL = {
  yt: "docker exec -i yourtal-postgres psql -U yourtal -d yourtal -XAt -F '|' -v ON_ERROR_STOP=1",
  snap: "docker exec -i snap-postgres psql -U postgres -d snapapps -XAt -F '|' -v ON_ERROR_STOP=1",
  ftr: "sudo -u postgres psql -d ftr_prod -XAt -F '|' -v ON_ERROR_STOP=1",
};
export const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
/** One query inside BEGIN READ ONLY … ROLLBACK; rows as arrays of strings. */
export function sql(db, query) {
  const out = execFileSync("ssh", [SSH, PSQL[db]], {
    input: `begin read only;\n${query};\nrollback;\n`,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((l) => l && l !== "BEGIN" && l !== "ROLLBACK")
    .map((l) => l.split("|"));
}
export const one = (db, q) => sql(db, q)[0]?.[0] ?? null;
export const num = (db, q) => Number(one(db, q));
export const storageHas = (dir) =>
  execFileSync("ssh", [SSH, `docker exec snap-apps-worker-1 sh -c 'test -d "$STORAGE_DIR"/${dir} && echo yes || echo no'`], {
    encoding: "utf8",
  }).trim() === "yes";

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────
export async function call(base, path, { method = "GET", token, body, headers = {}, raw } = {}) {
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
export async function until(what, fn, ms = WAIT_MS) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) { log(`timed out waiting for ${what}`); return null; }
    await sleep(5000);
  }
}

// ── YourTal accounts ────────────────────────────────────────────────────────────────────────
export async function newAccount(tag) {
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
/** The person's pairwise `sub` in one sector (`snapapp-staging` or `ftr`). */
export const subOf = (userId, sector) =>
  one("yt", `select sub from oidc.subject where user_id = ${lit(userId)} and sector = ${lit(sector)}`);
export const outbox = (sub) =>
  sql("yt", `select jti, client_id, event_type, payload::text, attempts, delivered_at is not null, failed_at is not null, coalesce(last_error,''),
    round(extract(epoch from (delivered_at - iat)))::text from oidc.event_outbox where sub = ${lit(sub)} order by iat`)
    .map(([jti, client, type, payload, attempts, delivered, failed, error, lag]) =>
      ({ jti, client, type, payload, attempts: Number(attempts), delivered: delivered === "t", failed: failed === "t", error, lag }));
/** Waits until every outbox row for `sub` is delivered or failed. */
export const settledOutbox = (sub, what) =>
  until(what, () => { const r = outbox(sub); return r.length && r.every((x) => x.delivered || x.failed) ? r : null; });

// ── Browser ─────────────────────────────────────────────────────────────────────────────────
let browser;
export async function page() {
  browser ??= await chromium.launch({ headless: process.env.CHECK_HEADED !== "1" });
  const ctx = await browser.newContext();
  return { ctx, p: await ctx.newPage() };
}
export const closeBrowser = () => browser?.close();
export async function shot(p, name) {
  mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: join(SHOTS, `${RUN}-${name}.png`), fullPage: true }).catch(() => {});
}
const pathOf = (p) => new URL(p.url()).pathname;
// YourTal allows 30 logins per address per 15 minutes; back off on a 429.
export async function ytLogin(p, who) {
  for (let i = 0; ; i++) {
    await p.fill("input[name=email]", who.email);
    await p.fill("input[name=password]", PASSWORD);
    await p.locator("button[type=submit]").first().click();
    await p.waitForURL((u) => !/\/login$/.test(new URL(String(u)).pathname) || /error=/.test(String(u)), { timeout: 30_000 });
    if (!/error=http_429/.test(p.url()) || i >= 16) break;
    log(`${who.tag}: login rate-limited (429), waiting 60s`);
    await sleep(60_000);
  }
  if (/\/login/.test(pathOf(p))) throw new Error(`${who.tag}: login failed (${new URL(p.url()).search})`);
  if (/\/passkey/.test(pathOf(p))) {
    await p.getByRole("button", { name: "Not now" }).or(p.getByRole("link", { name: "Not now" })).first().click();
    await p.waitForURL((u) => !/\/passkey/.test(String(u)), { timeout: 30_000 });
  }
}
/**
 * Takes the person through YourTal from wherever an app sent them: signs in if asked and taps
 * Continue on a consent screen. Stops when the browser leaves YourTal, or on a screen that is
 * not sign-in or consent (send, refused), which it names in `at`.
 */
export async function passYourTal(p, who, label) {
  let consent = false;
  for (let i = 0; i < 6; i++) {
    await p.waitForLoadState("networkidle");
    if (!p.url().startsWith(YT)) return { consent, at: "left" };
    if (/\/login/.test(pathOf(p))) { await ytLogin(p, who); continue; }
    const signIn = p.getByRole("link", { name: "Sign in", exact: true });
    if (await signIn.isVisible().catch(() => false)) {
      await signIn.click();
      await p.waitForURL(/\/login/);
      continue;
    }
    const cont = p.getByRole("button", { name: "Continue", exact: true });
    if (await cont.isVisible().catch(() => false)) {
      consent = true;
      await shot(p, `${label}-consent`);
      const before = p.url();
      await cont.click();
      await p.waitForURL((u) => String(u) !== before, { timeout: 45_000 });
      continue;
    }
    const send = await p.getByRole("button", { name: "Send", exact: true }).isVisible().catch(() => false);
    return { consent, at: send ? "send" : "other" };
  }
  return { consent, at: "other" };
}
/** Signs `who` in to SnapApp with YourTal. `keep` leaves the browser context open (returned as ctx, p). */
export async function snapSignIn(who, label, { keep = false } = {}) {
  const { ctx, p } = await page();
  await p.goto(`${SNAP_WEB}/auth/yourtal`);
  const { consent } = await passYourTal(p, who, label);
  await p.waitForURL((u) => String(u).startsWith(SNAP_WEB), { timeout: 45_000 });
  await p.waitForLoadState("networkidle");
  await shot(p, `${label}-snap`);
  const token = (await ctx.cookies(SNAP_WEB)).find((c) => c.name === "snap_session")?.value;
  const landed = pathOf(p);
  if (!keep) await ctx.close();
  if (!token) throw new Error(`${label}: no snap_session after sign-in (landed on ${landed})`);
  log(`${label}: signed in to SnapApp via YourTal (consent screen shown: ${consent}, landed ${landed})`);
  return { token, consent, landed, ctx, p };
}
/**
 * Signs `who` in to Free Tax Returns with its "Sign in with YourTal" button. Returns
 * `{ off: true }` when the button is not there (FTR's sign-in switch is off).
 */
export async function ftrSignIn(who, label, { keep = false } = {}) {
  const { ctx, p } = await page();
  await p.goto(`${FTR}/login`);
  await p.waitForLoadState("networkidle");
  const button = p.getByRole("button", { name: "Sign in with YourTal" });
  if (!(await button.isVisible().catch(() => false))) {
    await shot(p, `${label}-ftr-login`);
    await ctx.close();
    return { off: true };
  }
  await button.click();
  await p.waitForURL((u) => String(u).startsWith(YT), { timeout: 30_000 });
  const { consent, at } = await passYourTal(p, who, label);
  if (at !== "left") {
    await shot(p, `${label}-ftr-stuck`);
    throw new Error(`${label}: stopped at YourTal (${pathOf(p)}) on the way to FTR`);
  }
  await p.waitForURL((u) => String(u).startsWith(FTR) && !/\/api\/|\/auth\/continue/.test(String(u)), { timeout: 45_000 });
  await p.waitForLoadState("networkidle");
  await shot(p, `${label}-ftr`);
  const landed = pathOf(p);
  const error = new URL(p.url()).searchParams.get("error");
  if (!keep) await ctx.close();
  log(`${label}: signed in to FTR via YourTal (consent screen shown: ${consent}, landed ${landed}${error ? `, error=${error}` : ""})`);
  return { off: false, consent, landed, error, ctx, p };
}

// ── SnapApp data, through its API ───────────────────────────────────────────────────────────
export async function onboard(token, name) {
  const r = await call(SNAP_API, "/v1/workspaces/onboarding", { method: "POST", token, body: { workspaceName: name, kind: "personal" } });
  const ws = r.json?.workspaces?.[0]?.id ?? r.json?.workspace?.id ?? (await call(SNAP_API, "/v1/workspaces", { token })).json?.[0]?.id;
  log(`onboarding "${name}": ${r.status}, workspace ${ws}`);
  return ws;
}
export const snapSession = async (token) => (await call(SNAP_API, "/v1/auth/session", { token })).status;

// ── Cleanup: each leftover account deletes itself through the public API ───────────────────
// With the run's password a login gives a session; otherwise a password reset (its link read
// from the dev inbox; 3 an hour per address) does, which clears a broken run's accounts.
export async function deleteByEmail(email, password) {
  if (password) {
    const login = await call(YT, "/api/auth/login", { method: "POST", body: { email, password } });
    if (login.json?.token) {
      const del = await call(YT, "/api/me", { method: "DELETE", token: login.json.token });
      return log(`cleanup ${email}: login ${login.status}, DELETE /api/me ${del.status}`);
    }
  }
  const since = one("yt", "select now()");
  const req = await call(YT, "/api/auth/password/reset/request", { method: "POST", body: { email } });
  const token = await until(`reset mail for ${email}`, () =>
    one("yt", `select metadata->>'token' from platform.sim_outbox where recipient = ${lit(email)} and created_at >= ${lit(since)} and metadata ? 'token' order by created_at desc limit 1`), 60_000);
  const conf = token ? await call(YT, "/api/auth/password/reset/confirm", { method: "POST", body: { token, newPassword: `C1-${randomUUID()}` } }) : req;
  const del = conf.json?.token ? await call(YT, "/api/me", { method: "DELETE", token: conf.json.token }) : conf;
  log(`cleanup ${email}: reset ${req.status}/${conf.status}, DELETE /api/me ${del.status}`);
}
