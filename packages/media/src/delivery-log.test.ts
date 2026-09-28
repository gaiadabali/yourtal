import { execFileSync } from "node:child_process";
import { S3Client, CreateBucketCommand, PutBucketPolicyCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_ASSET_ID, HLS_PREFIX, MEDIA_BUCKET, segmentUrl } from "./hls-origin";
import { publishFixture } from "./publish-fixture";

/**
 * Per-segment delivery records exist. YT-0521, and the reason `docs/22`
 * cares about this ticket.
 *
 * ## What is being proved, and why it needed proving
 *
 * `docs/08` called cross-checking a claimed playback position against CDN
 * segment-delivery logs "the strongest web-native control we have". `docs/22`
 * audited that and found it **does not hold**: Cloudflare Stream's analytics
 * expose `date`, `datetime`, `uid`, `clientCountryName` and `creator` — no
 * viewer, session, IP or segment dimension to cross-check against — and
 * proxying segments to generate your own logs is explicitly unsupported.
 *
 * So the control was written into the plan as a strength while the data it
 * needs did not exist. `docs/22`'s answer is to self-host HLS on object
 * storage and log every fetch. This test is the evidence that the local
 * origin actually does, rather than another claim that a log exists
 * somewhere.
 *
 * ## What this does NOT prove
 *
 * Delivery is an **upper bound** — "you cannot claim more than was fetched"
 * — not evidence a human watched. `docs/22` is explicit: client-side
 * buffering counts as delivery, and a `curl` loop can pull every segment of
 * a 30-minute video in seconds and then claim a full watch. Promoting a
 * ceiling to a primary defence is the mistake being corrected, so this test
 * asserts the ceiling is measurable and claims nothing more.
 *
 * Note also that the client address in these records is the Docker gateway,
 * not the viewer. Attributing a fetch to a **session** is the hardening step
 * (`docs/22` option A signs per-session segment URLs); this proves the
 * per-segment record exists to attribute.
 *
 * ## F58: was `yourtal-minio` with `mc admin trace`
 *
 * RustFS ships no `mc` (only its own `rustfs` server binary), and its admin
 * trace API — while reachable over plain SigV4, no client needed — does NOT
 * populate S3-operation (GetObject/PutObject) events in its 1.0.0 GA:
 * confirmed empirically against a real container (the same endpoint streams
 * unrelated internal `scanner.Folder` events under `?all=true`, and the real
 * `mc admin trace` client connects and produces nothing for real GETs/PUTs
 * either). `RUSTFS_AUDIT_WEBHOOK_ENDPOINT` was also tried and never fired
 * for a real S3 op in the time available.
 *
 * What DOES work: RustFS's own structured JSON log (`/logs/rustfs.log` in
 * the container) emits one `"event":"http_request_completed"` record per
 * request, with `method`, `uri` (the full bucket/object path) and
 * `status_code` — real, per-request, per-path attribution, the same
 * property `mc admin trace` was proving. But it needs
 * `RUSTFS_OBS_LOGGER_LEVEL=debug` — confirmed empirically that `info` (the
 * record's own `"level":"INFO"` tag notwithstanding) never emits it, and
 * `debug` also emits ~900 lines of unrelated internal spans per request.
 * That is too noisy to run on `docker-compose.yml`'s/CI's shared RustFS
 * container all the time (the coordinator's call, 2026-09-28: staging and
 * dev stay at `info` unless the evidence is genuinely needed there), so
 * this test runs its OWN dedicated, disposable RustFS container at debug —
 * started and torn down here, never the shared `yourtal-rustfs` other
 * suites use. It also carries no response-byte-count field, so the "bytes
 * delivered" half of the ceiling comes from the client's own
 * `Content-Length` response header instead, which is exactly what a real
 * player already reads.
 */

// Same digest docker-compose.yml pins. Duplicated rather than imported: this
// is the one place a test manages its own container's full lifecycle.
const IMAGE =
  "rustfs/rustfs@sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff";
const CONTAINER = "yourtal-rustfs-delivery-log-test";
const PORT = 26902;
const ENDPOINT = `http://127.0.0.1:${String(PORT)}`;
const ROOT_USER = "yourtal";
const ROOT_PASSWORD = "yourtal_local_only";
const LOG_FILE = "/logs/rustfs.log";

const originalEnv = {
  S3_ENDPOINT: process.env["S3_ENDPOINT"],
  S3_ACCESS_KEY: process.env["S3_ACCESS_KEY"],
  S3_SECRET_KEY: process.env["S3_SECRET_KEY"],
};

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", CONTAINER, "sh", "-c", script], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

/** Bytes already in the log before this test's own fetches. */
function logSizeBytes(): number {
  const wc = inContainer(`wc -c < ${LOG_FILE} 2>/dev/null || echo 0`);
  return Number(wc.trim()) || 0;
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ENDPOINT}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${CONTAINER} never became healthy on ${ENDPOINT}/health`);
}

beforeAll(async () => {
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  } catch {
    // Nothing to remove.
  }
  execFileSync("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-p",
    `127.0.0.1:${String(PORT)}:9000`,
    "-e",
    `RUSTFS_ROOT_USER=${ROOT_USER}`,
    "-e",
    `RUSTFS_ROOT_PASSWORD=${ROOT_PASSWORD}`,
    "-e",
    "RUSTFS_OBS_LOGGER_LEVEL=debug",
    IMAGE,
  ]);
  await waitForHealth();

  // Root-only provisioning (F58): create the bucket and set the same
  // public-read policy `infra/helios/bootstrap.sh`'s own curl+SigV4 recipe
  // sets for real, so `publishFixture()`'s own check-and-warn (never set)
  // finds it already there. `MEDIA_BUCKET` ("yourtal-media"), not an env
  // override — `publishFixture()`'s own `ensureBucket`/`allowAnonymousRead
  // OfHls` always target that fixed constant, never `S3_BUCKET` (that env
  // var is Studio's own per-tenant/per-slot bucket, a different pipeline).
  const rootClient = new S3Client({
    endpoint: ENDPOINT,
    region: "us-east-1",
    credentials: { accessKeyId: ROOT_USER, secretAccessKey: ROOT_PASSWORD },
    forcePathStyle: true,
  });
  await rootClient.send(new CreateBucketCommand({ Bucket: MEDIA_BUCKET }));
  await rootClient.send(
    new PutBucketPolicyCommand({
      Bucket: MEDIA_BUCKET,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PublicReadHls",
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${MEDIA_BUCKET}/${HLS_PREFIX}/*`],
          },
        ],
      }),
    }),
  );
  rootClient.destroy();

  process.env["S3_ENDPOINT"] = ENDPOINT;
  process.env["S3_ACCESS_KEY"] = ROOT_USER;
  process.env["S3_SECRET_KEY"] = ROOT_PASSWORD;

  await publishFixture();
}, 30_000);

afterAll(() => {
  // Explicit keys, not a dynamic `delete process.env[key]` (banned):
  // this test only ever touches these three.
  if (originalEnv.S3_ENDPOINT === undefined) delete process.env["S3_ENDPOINT"];
  else process.env["S3_ENDPOINT"] = originalEnv.S3_ENDPOINT;
  if (originalEnv.S3_ACCESS_KEY === undefined) delete process.env["S3_ACCESS_KEY"];
  else process.env["S3_ACCESS_KEY"] = originalEnv.S3_ACCESS_KEY;
  if (originalEnv.S3_SECRET_KEY === undefined) delete process.env["S3_SECRET_KEY"];
  else process.env["S3_SECRET_KEY"] = originalEnv.S3_SECRET_KEY;
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  } catch {
    // Best-effort cleanup only.
  }
});

describe("per-segment delivery logging", () => {
  it("records one request per segment fetched, with the bytes delivered", async () => {
    const before = logSizeBytes();

    const fetched = [0, 2, 4];
    const delivered = new Map<number, number>();
    for (const index of fetched) {
      const response = await fetch(segmentUrl(FIXTURE_ASSET_ID, index));
      expect(response.ok).toBe(true);
      const body = await response.arrayBuffer();
      const contentLength = Number(response.headers.get("content-length") ?? body.byteLength);
      delivered.set(index, contentLength);
      // The response actually carried bytes — the ceiling this test proves
      // is meaningless against a 0-byte "delivery".
      expect(contentLength).toBeGreaterThan(0);
    }

    // The log is appended to as requests are served; give RustFS a moment
    // to flush before reading only what this test's own fetches added.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const appended = inContainer(`tail -c +${String(before + 1)} ${LOG_FILE} 2>/dev/null || true`);

    const records = appended
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.includes('"event":"http_request_completed"') &&
          line.includes('"method":"GET"') &&
          line.includes(FIXTURE_ASSET_ID),
      );

    // One record per segment actually requested — the per-segment granularity
    // Cloudflare Stream does not offer at any price.
    expect(records.length).toBeGreaterThanOrEqual(fetched.length);

    for (const index of fetched) {
      const forSegment = records.filter((line) => line.includes(`segment${String(index)}.ts`));
      expect(
        forSegment.length,
        `no delivery record for segment${String(index)}.ts; log was:\n${appended}`,
      ).toBeGreaterThanOrEqual(1);
      // Every matching record answered 200 — a failed fetch is not delivery.
      expect(forSegment.every((line) => line.includes('"status_code":200'))).toBe(true);
      // And the client's own response actually carried bytes (this file's
      // own header comment: the byte count comes from here, not the log).
      expect(delivered.get(index)).toBeGreaterThan(0);
    }

    // And the segment nobody asked for has no record. Without this the test
    // would pass against a log that recorded everything indiscriminately,
    // which would prove the opposite of attributable delivery.
    expect(records.some((line) => line.includes("segment1.ts"))).toBe(false);
    expect(records.some((line) => line.includes("segment3.ts"))).toBe(false);
  });
});
