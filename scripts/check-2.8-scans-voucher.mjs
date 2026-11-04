#!/usr/bin/env node
// 2.8 T8 (docs/28-snapapp-scans-voucher.md section 8): the SnapApp scans voucher on staging, over the
// public APIs only (YourTal and SnapApp), with evidence. Standalone: `fetch` only, no secret printed.
//
//   STAGING_REVIEW_PASSWORD=... node scripts/check-2.8-scans-voucher.mjs phase-a|phase-b|phase-c
//
// phase-a  the listing (A$5.00, online, ledger quote, stock), a teen cannot quote it, Studio lists the
//          merchant credential; with SNAP_APP_PARTNER_SECRET also the ownership read (held:false / 400).
// phase-b  demo adult A links a SnapApp demo user, A and B each buy the voucher; A redeems in SnapApp
//          (200, +50 credits once, status lists it, wallet reads redeemed); same code again (409
//          already_redeemed); B's code typed by A (409 not_your_voucher, B's stays active); a code of a
//          non-bound listing typed by A (409 not_your_voucher). Unlinks again at the end if it linked.
// phase-c  waits for the statement's 7-day dispute window: not run here.
//
// Accounts: the documented demo logins (the /review page lists them and the shared password):
// adult.au (A), guardian.au (B), viewer.au, teen.au, owner.au. SnapApp: its seeded demo identity
// (SNAP_CHECK_EMAIL, default sam@marshtransport.example, emailVerified, owner of a personal workspace):
// a fresh SnapApp account cannot prove its email, which linking and redeeming need.
// Env: YOURTAL_API (https://yourtal.gaiada.com), SNAP_API (https://snap-apps-api.gaiada.com).
import { createHmac, randomUUID } from "node:crypto";

const YT = (process.env.YOURTAL_API ?? "https://yourtal.gaiada.com").replace(/\/+$/, "");
const SNAP = (process.env.SNAP_API ?? "https://snap-apps-api.gaiada.com").replace(/\/+$/, "");
const PASSWORD = process.env.STAGING_REVIEW_PASSWORD;
const SNAP_EMAIL = process.env.SNAP_CHECK_EMAIL ?? "sam@marshtransport.example";
const PARTNER_SECRET = process.env.SNAP_APP_PARTNER_SECRET;
const LISTING_TITLE = "50 SnapApp scans";
const DEMO = (who) => `${who}.au@demo.yourtal.test`;
if (!PASSWORD) throw new Error("needs STAGING_REVIEW_PASSWORD (the /review page shows it)");

const scrub = (t) =>
  String(t)
    .split(PASSWORD)
    .join("<redacted>")
    .replace(/"token":"[^"]+"/g, '"token":"<t>"');
const say = (l) => console.log(scrub(l));
let failures = 0;
const expect = (cond, what, detail = "") => {
  if (!cond) failures += 1;
  say(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? ` -- ${detail}` : ""}`);
  return Boolean(cond);
};
const note = (what, detail = "") => say(`NOTE  ${what}${detail ? ` -- ${detail}` : ""}`);
const short = (v) => JSON.stringify(v)?.slice(0, 300);

async function http(base, method, path, headers, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...headers,
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
    // raw text is the useful part
  }
  return { status: res.status, body: json };
}

async function ytLogin(email) {
  const res = await http(YT, "POST", "/api/auth/login", {}, { email, password: PASSWORD });
  if (res.status !== 200 && res.status !== 201)
    throw new Error(`login ${email}: HTTP ${res.status} ${short(res.body)}`);
  return { cookie: { cookie: `yt_session=${res.body.token}` }, email };
}
const yt = (s, method, path, body) => http(YT, method, path, s.cookie, body);

async function snapLogin() {
  const res = await http(SNAP, "POST", "/v1/auth/sign-in", {}, { email: SNAP_EMAIL });
  if (res.status !== 200)
    throw new Error(`snap sign-in ${SNAP_EMAIL}: HTTP ${res.status} ${short(res.body)}`);
  const auth = { authorization: `Bearer ${res.body.token}` };
  const session = await http(SNAP, "GET", "/v1/auth/session", auth);
  const ws = session.body.workspaces.find((w) => w.kind === "personal" && w.role === "owner");
  if (!ws) throw new Error(`${SNAP_EMAIL} owns no personal workspace`);
  return { auth, ws: { ...auth, "x-workspace-id": ws.id }, wsName: ws.name };
}
const snap = (s, method, path, body) => http(SNAP, method, path, s.ws, body);

async function findListing(s) {
  for (let cursor = ""; ;) {
    const page = await yt(s, "GET", `/api/store/listings${cursor}`);
    const hit = page.body?.data?.find((l) => l.title === LISTING_TITLE);
    if (hit) return hit;
    if (!page.body?.has_more) return null;
    cursor = `?startingAfter=${page.body.data.at(-1).id}`;
  }
}

// ---------------------------------------------------------------- phase A

async function phaseA() {
  const viewer = await ytLogin(DEMO("viewer"));
  const listing = await findListing(viewer);
  if (!expect(listing, `viewer.au finds the "${LISTING_TITLE}" listing`)) return;
  say(
    `      listing ${listing.id}: ${short({ price: listing.priceInPoints, status: listing.status, stock: listing.stockRemaining, channel: listing.channel, face: listing.faceValueMinor ?? listing.settlementValueMinor, currency: listing.currency })}`,
  );
  expect(listing.channel === "online" && listing.currency === "AUD", "listing is online and AUD");
  expect((listing.stockRemaining ?? 0) > 0, "stock > 0", `stock ${listing.stockRemaining}`);

  const quote = await yt(viewer, "POST", "/api/checkout/quote", { listingId: listing.id });
  expect(
    quote.status === 201,
    "viewer.au (new, tier 0) can quote it",
    `HTTP ${quote.status} pricePoints ${quote.body?.pricePoints}`,
  );
  // docs/28 says 167 at B = 3c; B moves, so the check pins quote == listed price and reports the number.
  expect(
    quote.body?.pricePoints === listing.priceInPoints,
    "the quote equals the listed price (ledger quote, not 200)",
    `quote ${quote.body?.pricePoints}, listed ${listing.priceInPoints}`,
  );
  if (quote.body?.pricePoints !== 167)
    note(
      "price differs from docs/28's 167",
      `staging quotes ${quote.body?.pricePoints} (B has moved from 3c)`,
    );

  const teen = await ytLogin(DEMO("teen"));
  const teenQuote = await yt(teen, "POST", "/api/checkout/quote", { listingId: listing.id });
  expect(
    teenQuote.status >= 400 && teenQuote.status < 500,
    "a teen cannot quote it",
    `HTTP ${teenQuote.status} ${short(teenQuote.body)}`,
  );

  const owner = await ytLogin(DEMO("owner"));
  const biz = (await yt(owner, "GET", "/api/me/businesses")).body.find(
    (m) => m.business?.legalName === "Snap App Pty Ltd",
  )?.business;
  if (expect(biz, "owner.au is a member of Snap App Pty Ltd")) {
    const creds = await yt(owner, "GET", `/api/${biz.id}/studio/developers/credentials`);
    const rows = Array.isArray(creds.body)
      ? creds.body
      : (creds.body?.credentials ?? creds.body?.data ?? []);
    expect(
      creds.status === 200 && rows.length > 0,
      "Studio > Developers lists a credential",
      `HTTP ${creds.status}, ${rows.length} row(s): ${short(rows.map((r) => ({ label: r.label, keyId: r.keyId ?? r.id, status: r.status })))}`,
    );
  }

  if (!PARTNER_SECRET)
    return note(
      "ownership read direct check skipped",
      "SNAP_APP_PARTNER_SECRET not set (phase B exercises it through SnapApp: not_your_voucher)",
    );
  const partner = async (body) => {
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", PARTNER_SECRET).update(raw, "utf8").digest("hex");
    const res = await fetch(`${YT}/api/partners/vouchers/owner`, {
      method: "POST",
      headers: {
        authorization: `Partner snap-app:${sig}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: raw,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const unknown = await partner({ linkId: randomUUID(), codeSha256: "0".repeat(64) });
  expect(
    unknown.status === 400,
    "ownership read: unknown link is 400",
    `HTTP ${unknown.status} ${short(unknown.body)}`,
  );
}

// ---------------------------------------------------------------- phase B

const credits = async (s) => (await snap(s, "GET", "/v1/credits")).body?.creditsRemaining;
const points = async (u) => (await yt(u, "GET", "/api/wallet")).body?.availablePoints;

async function buy(user, listingId) {
  const q = await yt(user, "POST", "/api/checkout/quote", { listingId });
  if (q.status !== 201) throw new Error(`${user.email} quote: HTTP ${q.status} ${short(q.body)}`);
  const done = await yt(user, "POST", "/api/checkout", { checkoutId: q.body.checkoutId });
  if (done.status !== 200)
    throw new Error(`${user.email} checkout: HTTP ${done.status} ${short(done.body)}`);
  for (let i = 0; i < 20; i += 1) {
    const v = await yt(user, "GET", `/api/wallet/vouchers/${done.body.voucherId}`);
    if (v.body?.code) return { id: done.body.voucherId, price: q.body.pricePoints, detail: v.body };
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${user.email}: voucher ${done.body.voucherId} never showed a code`);
}

async function phaseB() {
  const [a, b] = [await ytLogin(DEMO("adult")), await ytLogin(DEMO("guardian"))];
  const viewer = await ytLogin(DEMO("viewer"));
  const listing = await findListing(viewer);
  if (!expect(listing, `the "${LISTING_TITLE}" listing exists`)) return;
  const s = await snapLogin();
  say(`      SnapApp user ${SNAP_EMAIL}, workspace "${s.wsName}"`);

  let link = (await snap(s, "GET", "/v1/yourtal/link")).body;
  let linkedHere = false;
  if (link.state === "linked") note("SnapApp user was already linked; left linked");
  else {
    const code = await yt(a, "POST", "/api/me/linked-apps/code", {});
    const linked = await snap(s, "POST", "/v1/yourtal/link", { code: code.body?.code });
    if (
      !expect(
        linked.status === 200 && linked.body?.state === "linked",
        "A links the SnapApp user",
        `YourTal code HTTP ${code.status}; SnapApp HTTP ${linked.status} ${short(linked.body?.state ?? linked.body)}`,
      )
    )
      return;
    linkedHere = true;
  }
  try {
    link = (await snap(s, "GET", "/v1/yourtal/link")).body;
    if (
      !expect(
        link.vouchers?.available === true,
        "GET /v1/yourtal/link: vouchers.available",
        short(link.vouchers),
      )
    )
      return;

    const [pointsA0, pointsB0, creditsBefore] = [
      await points(a),
      await points(b),
      await credits(s),
    ];
    const va = await buy(a, listing.id);
    const vb = await buy(b, listing.id);
    const [pointsA1, pointsB1] = [await points(a), await points(b)];
    expect(
      pointsA0 - pointsA1 === va.price && pointsB0 - pointsB1 === vb.price,
      "buying burns the quoted points",
      `A ${pointsA0} -> ${pointsA1}, B ${pointsB0} -> ${pointsB1}, price ${va.price}`,
    );
    expect(
      va.detail.redeemIn?.partnerId === "snap-app" && va.detail.status === "active",
      "wallet shows redeemIn snap-app, status active",
      short({ redeemIn: va.detail.redeemIn, status: va.detail.status }),
    );

    const wrong = await snap(s, "POST", "/v1/yourtal/vouchers/redeem", { code: vb.detail.code });
    expect(
      wrong.status === 409 && wrong.body?.error === "not_your_voucher",
      "A types B's code: 409 not_your_voucher",
      `HTTP ${wrong.status} ${short(wrong.body)}`,
    );
    const bAfter = (await yt(b, "GET", `/api/wallet/vouchers/${vb.id}`)).body;
    expect(bAfter.status === "active", "B's voucher is still active", `status ${bAfter.status}`);

    const mine = (await yt(a, "GET", "/api/wallet/vouchers")).body.vouchers.filter(
      (v) => v.listingId !== listing.id && v.status === "active",
    );
    if (mine.length > 0) {
      const other = (await yt(a, "GET", `/api/wallet/vouchers/${mine[0].voucherId}`)).body;
      if (other.code) {
        const r = await snap(s, "POST", "/v1/yourtal/vouchers/redeem", { code: other.code });
        expect(
          r.status === 409 && r.body?.error === "not_your_voucher",
          "A's own voucher of a non-bound listing: 409 not_your_voucher",
          `HTTP ${r.status} ${short(r.body)}`,
        );
      }
    } else note("no non-bound active voucher in A's wallet; that wrong-partner case skipped");

    const ok = await snap(s, "POST", "/v1/yourtal/vouchers/redeem", { code: va.detail.code });
    expect(
      ok.status === 200 && ok.body?.state === "granted",
      "A redeems her code in SnapApp: 200 granted",
      `HTTP ${ok.status} ${short(ok.body)}`,
    );
    let creditsAfter = await credits(s);
    for (let i = 0; i < 20 && creditsAfter === creditsBefore && ok.status === 202; i += 1) {
      await new Promise((r) => setTimeout(r, 5000));
      creditsAfter = await credits(s);
    }
    expect(
      creditsAfter - creditsBefore === 50,
      "SnapApp credits +50 exactly",
      `${creditsBefore} -> ${creditsAfter}`,
    );
    const status = (await snap(s, "GET", "/v1/yourtal/link")).body;
    expect(
      status.vouchers.redemptions.some((r) => r.state === "granted" && r.credits === 50),
      "status lists a granted redemption of 50",
      short(status.vouchers.redemptions[0]),
    );
    const aAfter = (await yt(a, "GET", `/api/wallet/vouchers/${va.id}`)).body;
    expect(
      aAfter.status === "redeemed",
      "YourTal shows A's voucher redeemed",
      `status ${aAfter.status}`,
    );

    const again = await snap(s, "POST", "/v1/yourtal/vouchers/redeem", { code: va.detail.code });
    expect(
      again.status === 409 && again.body?.error === "already_redeemed",
      "same code again: 409 already_redeemed",
      `HTTP ${again.status} ${short(again.body)}`,
    );
    expect(
      (await credits(s)) === creditsAfter,
      "credits unchanged after the double redeem",
      `${await credits(s)}`,
    );
    note(
      "scan on voucher credits reads skipped_free",
      "not run: needs a receipt photo scanned in SnapApp",
    );
  } finally {
    if (linkedHere) {
      const un = await snap(s, "DELETE", "/v1/yourtal/link");
      note("unlinked the SnapApp user again", `HTTP ${un.status}`);
    }
  }
}

const phase = process.argv[2];
const phases = { "phase-a": phaseA, "phase-b": phaseB };
if (phase === "phase-c") {
  say(
    "phase-c waits for the 7-day dispute window (statement, two finance staff, Studio > Payouts): not run.",
  );
} else if (!phases[phase]) {
  say("usage: check-2.8-scans-voucher.mjs phase-a|phase-b|phase-c");
  process.exit(2);
} else {
  try {
    await phases[phase]();
  } catch (e) {
    failures += 1;
    say(`FAIL  ${e.message}`);
  }
  say(failures === 0 ? `RESULT: ${phase} PASS` : `RESULT: ${phase} FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
