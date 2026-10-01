#!/usr/bin/env node
// 13.1.c on staging: every demo login works and its screens have data, in
// both regions. `reset` presses the staff console's reset (as the demo admin);
// `check` signs in as every demo account and reads what its screens read.
// Run on Helios with app.env loaded; the password never leaves the env.
//   node check-13.1-demo-world.mjs reset|check
import { randomUUID } from "node:crypto";

const API = process.env.DEMO_API_BASE_URL ?? "http://127.0.0.1:26301";
const PASSWORD = process.env.STAGING_DEMO_PASSWORD;
if (!PASSWORD) throw new Error("needs STAGING_DEMO_PASSWORD");

async function call(method, path, cookie, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "idempotency-key": randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function login(email) {
  for (;;) {
    const res = await call("POST", "/api/auth/login", undefined, { email, password: PASSWORD });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (res.body?.retryAfterSeconds ?? 60) * 1000));
      continue;
    }
    if (res.status >= 400) return null;
    return `yt_session=${res.body.token}`;
  }
}

const results = [];
function record(who, what, ok, detail) {
  results.push({ who, what, ok, detail });
}

async function expectList(who, cookie, path, key, what, min = 1) {
  const res = await call("GET", path, cookie);
  const list = key ? res.body?.[key] : res.body;
  const n = Array.isArray(list) ? list.length : -1;
  record(who, what, res.status === 200 && n >= min, `${res.status}, ${n}`);
  return Array.isArray(list) ? list : [];
}

if (process.argv[2] === "reset") {
  const admin = await login("admin@demo.yourtal.test");
  const res = await call("POST", "/api/dev/demo/reset", admin, {});
  console.log(`reset: ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(res.status === 202 ? 0 : 1);
}

for (const region of ["AU", "ID"]) {
  const r = region.toLowerCase();
  for (const who of ["viewer", "adult", "teen", "guardian"]) {
    const email = `${who}.${r}@demo.yourtal.test`;
    const cookie = await login(email);
    record(email, "login", cookie !== null, "");
    if (cookie === null) continue;
    const feed = await expectList(email, cookie, "/api/feed", "items", "home feed");
    if (who === "teen") {
      const wrong = feed.filter((i) => i.audience && !["teen", "all_ages"].includes(i.audience));
      record(email, "teen feed only teen/all_ages", wrong.length === 0, `${wrong.length} other`);
    }
    await expectList(email, cookie, "/api/store/listings", "data", "store");
    const wallet = await call("GET", "/api/wallet", cookie);
    record(email, "wallet", wallet.status === 200, `${wallet.status}`);
    if (who !== "teen") {
      await expectList(email, cookie, "/api/auctions", "auctions", "open auctions");
      await expectList(
        email,
        cookie,
        `/api/charities?region=${region}`,
        "charities",
        "charities",
        2,
      );
    }
    if (who === "adult" || who === "guardian") {
      await expectList(email, cookie, "/api/wallet/gifts", "gifts", "gifts");
    }
  }
  for (const who of ["owner", "member", "finance"]) {
    const email = `${who}.${r}@demo.yourtal.test`;
    const cookie = await login(email);
    record(email, "login", cookie !== null, "");
    if (cookie !== null)
      await expectList(email, cookie, "/api/me/businesses", null, "studio businesses", 2);
  }
  for (const who of ["charity1", "charity2"]) {
    const email = `${who}.${r}@demo.yourtal.test`;
    const cookie = await login(email);
    record(email, "login", cookie !== null, "");
    if (cookie !== null)
      await expectList(email, cookie, "/api/me/charities", "charities", "charity console");
  }
}
for (const who of ["admin", "support", "moderator", "risk-analyst", "finance", "ops"]) {
  const email = `${who}@demo.yourtal.test`;
  const cookie = await login(email);
  record(email, "login", cookie !== null, "");
  if (cookie === null) continue;
  const me = await call("GET", "/api/staff/me", cookie);
  const roles = me.body?.roles ?? [];
  record(
    email,
    "staff console",
    me.status === 200 && (who !== "admin" || roles.length === 6),
    roles.join(","),
  );
}

for (const r of results)
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.who} — ${r.what} (${r.detail})`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
