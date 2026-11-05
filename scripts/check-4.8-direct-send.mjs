#!/usr/bin/env node
// Group 4.8 / C1 (docs/30-snapapp-to-ftr-direct-send.md §12): "Send to Free Tax Returns" from
// SnapApp staging, confirmed on YourTal, lands as a pending import at FTR. Fresh `.test`
// accounts only; writes only through the apps' screens and public APIs; databases read
// over ssh in READ ONLY transactions (ftr_prod holds real customers: every FTR read names the
// run's own email). Never prints a password, token, assertion or full `sub`.
//
//   node scripts/check-4.8-direct-send.mjs dark      FTR's switches off: FTR's transfer route is 404;
//                                                    N, never at FTR, gets "not_connected" at YourTal.
//   node scripts/check-4.8-direct-send.mjs window    FTR's sign-in, import and transfer switches on:
//                                                    Phase A (send lands as one pending import), then
//                                                    Phase B (Cancel sends nothing), then G is deleted
//                                                    and FTR erases G with the import.
//   node scripts/check-4.8-direct-send.mjs cleanup <email>…
//
// SnapApp's deductions come from a work trip (POST /v1/trips): the bundle's workKilometres,
// through the public API. A receipt line needs a real extraction, and the 4.9 golden fixture
// is seeded with SQL, which this check may not do on Helios.
// Env: see scripts/lib/staging-check.mjs.
import {
  FTR, PASSWORD, RUN, SNAP_API, SNAP_WEB, YT, call, check, closeBrowser, deleteByEmail, ftrSignIn,
  lit, log, newAccount, onboard, outbox, settledOutbox, shot, show, snapSignIn, sql, subOf, summary,
} from "./lib/staging-check.mjs";

const KM = 12;
const leftovers = []; // accounts this run made and has not deleted yet

// ── Reads ───────────────────────────────────────────────────────────────────────────────────
function ftrImports(email) {
  return sql("ftr", `select i.id, i.status, i.fiscal_year, i.source_app, i.line_count, i.bundle::text
    from deduction_imports i join "user" u on u.id = i.user_id where lower(u.email) = ${lit(email)} order by i.created_at`)
    .map(([id, status, year, source, lines, bundle]) => ({ id, status, year, source, lines: Number(lines), km: JSON.parse(bundle).workKilometres }));
}
const ftrUsers = (email) => Number(sql("ftr", `select count(*) from "user" where lower(email) = ${lit(email)}`)[0][0]);
const ftrTransferAudit = (importId) =>
  Number(sql("ftr", `select count(*) from audit_log where action = 'yourtal.transfer' and meta->>'importId' = ${lit(importId)}`)[0][0]);
const snapSends = (ws) =>
  sql("snap", `select status, coalesce(error,''), ftr_import_id is not null, bundle is null from ftr_sends where tenant_id = ${lit(ws)} order by created_at`)
    .map(([status, error, imported, dropped]) => ({ status, error, imported: imported === "t", bundleDropped: dropped === "t" }));

// ── SnapApp side ────────────────────────────────────────────────────────────────────────────
/** A personal workspace with one work trip in the year SnapApp will send. Returns { ws, year }. */
async function snapWithTrip(token, who) {
  const ws = await onboard(token, `C1 ${RUN} ${who.tag.toUpperCase()} home`);
  const y = await call(SNAP_API, "/v1/deduction-bundle/year", { token, headers: { "x-workspace-id": ws } });
  const year = y.json?.financialYear;
  const trip = await call(SNAP_API, "/v1/trips", {
    method: "POST", token, headers: { "x-workspace-id": ws },
    body: { date: `${year.slice(0, 4)}-08-01`, fromPlace: "Home", toPlace: "Site", km: KM, purpose: "Work travel", workRelated: true },
  });
  log(`${who.tag}: year ${year} (directSend ${y.json?.directSend}), trip POST ${trip.status}`);
  check(`${who.tag}: SnapApp offers direct send for ${year}`, y.status === 200 && y.json?.directSend === true, `GET /v1/deduction-bundle/year ${y.status}`);
  return { ws, year };
}
/**
 * Categories → "Send to Free Tax Returns" → YourTal. `choice` is "Send", "Cancel" or null (just
 * report the screen). Returns what YourTal showed and what SnapApp said afterwards.
 */
async function sendFromCategories(p, label, choice) {
  await p.goto(`${SNAP_WEB}/app/categories`);
  await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Send to Free Tax Returns", exact: true }).click();
  await p.waitForURL((u) => String(u).startsWith(YT), { timeout: 30_000 });
  await p.waitForLoadState("networkidle");
  const screen = (await p.locator("body").innerText()).replace(/\s+/g, " ");
  await shot(p, `${label}-yourtal`);
  const sendVisible = await p.getByRole("button", { name: "Send", exact: true }).isVisible().catch(() => false);
  if (choice && sendVisible) await p.getByRole("button", { name: choice, exact: true }).click();
  else {
    // A refusal screen: leave by its own way back (its single button or link), as a person would.
    const back = p.getByRole("button").or(p.getByRole("link")).filter({ hasText: /back|snapapp|cancel|continue/i }).first();
    if (await back.isVisible().catch(() => false)) await back.click();
  }
  await p.waitForURL((u) => String(u).startsWith(SNAP_WEB), { timeout: 45_000 }).catch(() => {});
  await p.waitForLoadState("networkidle");
  await shot(p, `${label}-snap-after`);
  const after = p.url().startsWith(SNAP_WEB)
    ? (await p.getByRole("status").or(p.getByRole("alert")).allInnerTexts().catch(() => [])).join(" | ")
    : `(still at ${new URL(p.url()).pathname})`;
  log(`${label}: YourTal showed "${screen.slice(0, 220)}…"; after: ${p.url().replace(/\?.*/, "")} "${after}"`);
  return { screen, sendVisible, after, url: p.url() };
}

// ── Phases ──────────────────────────────────────────────────────────────────────────────────
async function dark() {
  console.log(`\n=== Dark: FTR's switches off (run ${RUN}) ===`);
  const t = await call(FTR, "/api/yourtal/transfers", { method: "POST", headers: { authorization: "Bearer x" }, body: {} });
  check("FTR's transfer route answers 404 while switched off", t.status === 404, `${t.status}`);
  const ftrLogin = await (await fetch(`${FTR}/login`)).text();
  check("FTR's /login has no 'Sign in with YourTal' while switched off", !ftrLogin.includes("Sign in with YourTal"));

  const N = await newAccount("n");
  leftovers.push(N);
  const n = await snapSignIn(N, "n", { keep: true });
  const { ws } = await snapWithTrip(n.token, N);
  const r = await sendFromCategories(n.p, "n", null);
  check("N (never at FTR): YourTal refuses with not_connected, nothing sent",
    !r.sendVisible && /Sign in to Free Tax Returns with YourTal once/.test(r.screen) && /Nothing was sent/.test(r.screen));
  show("SnapApp ftr_sends for N", snapSends(ws));
  check("SnapApp holds no sent row for N", !snapSends(ws).some((s) => s.status === "sent"));
  check("FTR has no user for N", ftrUsers(N.email) === 0);
  await n.ctx.close();
}

async function windowRun() {
  console.log(`\n=== Window, Phase A: a send lands at FTR (run ${RUN}) ===`);
  const G = await newAccount("g");
  leftovers.push(G);
  const g = await ftrSignIn(G, "g");
  if (g.off) {
    check("FTR shows 'Sign in with YourTal' (its switch is on)", false, "no button on /login");
    return;
  }
  check("G signs in to FTR once through YourTal", g.landed.startsWith("/account") && !g.error, `landed ${g.landed}`);
  G.ftrSub = subOf(G.userId, "ftr");
  const s = await snapSignIn(G, "g", { keep: true });
  const { ws, year } = await snapWithTrip(s.token, G);
  const before = ftrImports(G.email);
  show("FTR deduction_imports for G, before", before);

  const sent = await sendFromCategories(s.p, "g-send", "Send");
  check("YourTal shows the send screen naming the year and Free Tax Returns",
    sent.sendVisible && sent.screen.includes(`Send your ${year} deductions to Free Tax Returns?`));
  check("SnapApp says Sent", /Sent\. Your .* deductions are waiting in Free Tax Returns/.test(sent.after), sent.after);
  const after = ftrImports(G.email);
  show("FTR deduction_imports for G, after", after);
  const added = after.filter((a) => !before.some((b) => b.id === a.id));
  check("FTR has one new pending import from SnapApp for that year, with the trip's km",
    added.length === 1 && added[0].status === "pending" && added[0].source === "snapapp" && added[0].km === KM,
    JSON.stringify(added.map(({ id, ...x }) => x)));
  check("FTR wrote its yourtal.transfer audit row", added[0] ? ftrTransferAudit(added[0].id) === 1 : false);
  show("SnapApp ftr_sends", snapSends(ws));
  check("SnapApp's send row is sent, bytes dropped", snapSends(ws).at(-1)?.status === "sent" && snapSends(ws).at(-1)?.bundleDropped);

  console.log(`\n=== Window, Phase B: Cancel sends nothing (run ${RUN}) ===`);
  const cancelled = await sendFromCategories(s.p, "g-cancel", "Cancel");
  check("Cancel: SnapApp says Nothing was sent.", /Nothing was sent\./.test(cancelled.after), cancelled.after);
  const afterCancel = ftrImports(G.email);
  check("FTR has no new import after Cancel", afterCancel.length === after.length, `${after.length} → ${afterCancel.length}`);
  check("SnapApp's second send row is cancelled", snapSends(ws).at(-1)?.status === "cancelled", JSON.stringify(snapSends(ws).at(-1)));
  await s.ctx.close();

  console.log(`\n=== Window: G is deleted; FTR erases G and the import ===`);
  leftovers.splice(leftovers.indexOf(G), 1);
  await deleteByEmail(G.email, PASSWORD);
  const rows = await settledOutbox(G.ftrSub, "G's outbox row to ftr-web");
  for (const r of rows ?? outbox(G.ftrSub)) show("outbox row (ftr sector)", { client: r.client, type: r.type, delivered: r.delivered, error: r.error, lag: r.lag });
  check("FTR: G's user and imports are gone", ftrUsers(G.email) === 0 && ftrImports(G.email).length === 0);
  check("FTR: G's sub is on yourtal_erased_subjects",
    Number(sql("ftr", `select count(*) from yourtal_erased_subjects where sub = ${lit(G.ftrSub)}`)[0][0]) === 1);
}

const what = process.argv[2] ?? "dark";
if (what === "cleanup") {
  for (const email of process.argv.slice(3)) await deleteByEmail(email);
  process.exit(0);
}
try {
  if (what === "dark") await dark();
  else if (what === "window") await windowRun();
  else throw new Error(`unknown command ${what}`);
} catch (error) {
  check("run finished without an exception", false, error.stack ?? String(error));
} finally {
  await closeBrowser();
  if (process.env.CHECK_KEEP !== "1")
    for (const who of leftovers) if (who?.email) await deleteByEmail(who.email, PASSWORD);
}
process.exit(summary());
