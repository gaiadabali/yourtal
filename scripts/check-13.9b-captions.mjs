#!/usr/bin/env node
// 13.9.b on staging: a captioned campaign goes live through the real routes.
// The demo owner uploads a clip with an embedded English subtitle track, the
// worker's transcode extracts it, the owner completes and submits the
// campaign, and the demo moderator approves it. Run on Helios with app.env
// loaded; the password is read from the environment and never printed.
//   node check-13.9b-captions.mjs <clip.mp4>
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const API = process.env.DEMO_API_BASE_URL ?? "http://127.0.0.1:26301";
const PASSWORD = process.env.STAGING_DEMO_PASSWORD;
const BUSINESS = "00000000-0000-4000-9000-000000000001"; // snap-app AU, KYB verified
const clip = process.argv[2];
if (!PASSWORD || !clip) throw new Error("needs STAGING_DEMO_PASSWORD and a clip path");

async function call(method, path, body, cookie) {
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
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return json;
}

async function login(email) {
  const body = await call("POST", "/api/auth/login", { email, password: PASSWORD });
  return `yt_session=${body.token}`;
}

const owner = await login("owner.au@demo.yourtal.test");
const moderator = await login("moderator@demo.yourtal.test");
const studio = `/api/${BUSINESS}/studio`;
const now = Date.now();

const campaign = await call(
  "POST",
  `${studio}/campaigns`,
  {
    kind: "long_form",
    title: "Sintel, with captions",
    synopsis:
      "A short look at Sintel's journey. Watch to the end and answer a question to earn points.",
    durationSeconds: 180,
    contentCategory: "entertainment",
    audience: "all_ages",
    startsAt: new Date(now).toISOString(),
    endsAt: new Date(now + 60 * 86_400_000).toISOString(),
    openViewing: true,
  },
  owner,
);
console.log(`campaign ${campaign.id} created`);

const bytes = readFileSync(clip);
const upload = await call(
  "POST",
  `${studio}/media/initiate`,
  {
    campaignId: campaign.id,
    filename: "sintel-captions.mp4",
    contentType: "video/mp4",
    sizeBytes: statSync(clip).size,
  },
  owner,
);
const parts = [];
for (const part of upload.parts) {
  const start = (part.partNumber - 1) * upload.partSizeBytes;
  const res = await fetch(part.url, {
    method: "PUT",
    body: bytes.subarray(start, start + upload.partSizeBytes),
  });
  if (!res.ok) throw new Error(`part ${part.partNumber}: ${res.status}`);
  parts.push({ partNumber: part.partNumber, eTag: res.headers.get("etag") });
}
await call("POST", `${studio}/media/${upload.assetId}/complete`, { parts }, owner);

let asset;
for (let i = 0; i < 120; i += 1) {
  asset = await call("GET", `${studio}/media/${upload.assetId}`, undefined, owner);
  if (asset.status === "ready" || asset.status === "failed") break;
  await new Promise((r) => setTimeout(r, 5_000));
}
console.log(`asset ${upload.assetId}: ${asset.status}, captions ${asset.captionsUrl ?? "none"}`);
if (asset.status !== "ready") process.exit(1);

await call(
  "PATCH",
  `${studio}/campaigns/${campaign.id}`,
  {
    chapters: [{ title: "Sintel", startSeconds: 0, rewardWeight: 1 }],
  },
  owner,
);
const facts = [
  "Points unlock after a short hold.",
  "Rewards come from local brands.",
  "Watch to the end to earn.",
];
for (const [index, fact] of facts.entries()) {
  const options = [fact, ...facts.filter((f) => f !== fact)].map((label) => ({
    id: randomUUID(),
    label,
  }));
  await call(
    "POST",
    `${studio}/campaigns/${campaign.id}/questions`,
    {
      id: randomUUID(),
      campaignId: campaign.id,
      type: "multiple_choice",
      prompt: "What did the captions say?",
      options,
      correctOptionId: options[0].id,
      answerableAfterSeconds: [36, 66, 126][index],
      timerSeconds: 30,
    },
    owner,
  );
}
const bought = await call(
  "POST",
  `${studio}/billing/purchases`,
  { points: 20_000, currency: "AUD" },
  owner,
);
await call(
  "PUT",
  `${studio}/campaigns/${campaign.id}/reward`,
  {
    allocationId: bought.allocation.allocationId,
    rewardPointsPerCompletion: 20,
    accuracyBonusPoints: 0,
    maxPointsForCampaign: 20_000,
  },
  owner,
);
await call("POST", `${studio}/campaigns/${campaign.id}/submit`, {}, owner);
const approved = await call(
  "POST",
  `/api/staff/moderation/campaigns/${campaign.id}/approve`,
  {
    reason: "Captions check: content and captions reviewed.",
  },
  moderator,
);
console.log(
  `campaign ${campaign.id}: ${approved.lifecycleState ?? approved.state ?? JSON.stringify(approved).slice(0, 120)}`,
);
