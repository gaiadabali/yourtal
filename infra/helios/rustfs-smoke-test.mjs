#!/usr/bin/env node
// 7.9.c: the presigned-upload round trip rustfs-cutover.sh's own smoke test
// promises. Plain Node (built-in fetch, no deps) rather than curl+grep --
// JSON this nested is not worth hand-parsing in bash.
//
// Logs in as a real demo business owner, creates a throwaway draft
// campaign, initiates a real multipart upload, PUTs a tiny real part
// straight to the (now RustFS) presigned URL, completes it, and asserts
// the api answers "queued" -- proving initiate -> presign -> PUT ->
// complete works end to end against the real storage backend, not just
// that the endpoint is reachable.
//
// Usage: node rustfs-smoke-test.mjs
// Env: API_BASE (default http://127.0.0.1:26301), DEMO_EMAIL (default
// owner.au@demo.yourtal.test), DEMO_PASSWORD (required).
// Prints exactly one line starting "RESULT:" with a JSON summary; the
// caller (rustfs-cutover.sh) greps for that line. Non-zero exit on any
// failure, with the reason on stderr.

const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:26301";
const EMAIL = process.env.DEMO_EMAIL ?? "owner.au@demo.yourtal.test";
const PASSWORD = process.env.DEMO_PASSWORD;

function fail(message) {
  console.error(`[rustfs-smoke-test] FAILED: ${message}`);
  process.exit(1);
}

async function req(method, path, token, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

async function main() {
  if (!PASSWORD) fail("DEMO_PASSWORD env var is required");

  const login = await req("POST", "/api/auth/login", undefined, {
    email: EMAIL,
    password: PASSWORD,
  });
  if (login.status !== 200 || !login.json.token) {
    fail(`login failed: ${login.status} ${JSON.stringify(login.json)}`);
  }
  const token = login.json.token;

  const businesses = await req("GET", "/api/me/businesses", token);
  if (
    businesses.status !== 200 ||
    !Array.isArray(businesses.json) ||
    businesses.json.length === 0
  ) {
    fail(
      `GET /api/me/businesses returned no memberships: ${businesses.status} ${JSON.stringify(businesses.json)}`,
    );
  }
  const businessId = businesses.json[0].business.id;

  const now = Date.now();
  const draft = await req("POST", `/api/${businessId}/studio/campaigns`, token, {
    kind: "quick",
    title: "rustfs-cutover smoke test",
    synopsis:
      "Created and deleted by infra/helios/rustfs-cutover.sh (7.9.c). Safe to delete if found stale.",
    durationSeconds: 60,
    contentCategory: "services",
    audience: "all_ages",
    startsAt: new Date(now).toISOString(),
    endsAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  });
  if (draft.status !== 201 || !draft.json.id) {
    fail(`campaign draft create failed: ${draft.status} ${JSON.stringify(draft.json)}`);
  }
  const campaignId = draft.json.id;

  const initiate = await req("POST", `/api/${businessId}/studio/media/initiate`, token, {
    campaignId,
    filename: "rustfs-cutover-smoke-test.mp4",
    contentType: "video/mp4",
    sizeBytes: 1024,
    teaserStartSeconds: 0,
  });
  if (initiate.status !== 201 || !initiate.json.assetId || !Array.isArray(initiate.json.parts)) {
    fail(`media initiate failed: ${initiate.status} ${JSON.stringify(initiate.json)}`);
  }
  const { assetId, parts } = initiate.json;
  if (parts.length === 0) fail("media initiate returned zero presigned parts");

  const eTags = [];
  const body = Buffer.alloc(1024, "x");
  for (const part of parts) {
    const put = await fetch(part.url, { method: "PUT", body });
    if (!put.ok) fail(`PUT to presigned part ${part.partNumber} failed: ${put.status}`);
    const eTag = put.headers.get("etag");
    if (!eTag) fail(`PUT to presigned part ${part.partNumber} returned no ETag`);
    eTags.push({ partNumber: part.partNumber, eTag });
  }

  const complete = await req("POST", `/api/${businessId}/studio/media/${assetId}/complete`, token, {
    parts: eTags,
  });
  if (complete.status !== 200 || complete.json.status !== "queued") {
    fail(
      `media complete did not report queued: ${complete.status} ${JSON.stringify(complete.json)}`,
    );
  }

  console.log(`RESULT:${JSON.stringify({ ok: true, businessId, campaignId, assetId })}`);
}

main().catch((error) => fail(error instanceof Error ? error.stack : String(error)));
