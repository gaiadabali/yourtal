import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_ASSET_ID, segmentUrl } from "./hls-origin";
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
 */

// F58: was `yourtal-minio` with `mc admin trace`. RustFS ships no `mc` (only
// its own `rustfs` server binary), and its admin trace API — while reachable
// over plain SigV4, no client needed — does NOT populate S3-operation
// (GetObject/PutObject) events in its 1.0.0 GA: confirmed empirically
// against a real container (the same endpoint streams unrelated internal
// `scanner.Folder` events under `?all=true`, and the real `mc admin trace`
// client connects and produces nothing for real GETs/PUTs either). The
// `RUSTFS_AUDIT_WEBHOOK_ENDPOINT` mechanism was also tried and never fired
// for a real S3 op in the time available.
//
// What DOES work: at `RUSTFS_OBS_LOGGER_LEVEL=info` (`docker-compose.yml`/
// CI's own env, not the image's noisier DEBUG default), RustFS's own
// structured JSON log (`/logs/rustfs.log` in the container) emits one
// `"event":"http_request_completed"` record per request, with `method`,
// `uri` (the full bucket/object path) and `status_code` — real,
// per-request, per-path attribution, the same property `mc admin trace`
// was proving. It carries no response-byte-count field at INFO (DEBUG
// does, buried in ~900 lines of internal spans per request — too noisy to
// depend on here), so the "bytes delivered" half of the ceiling comes from
// the client's own `Content-Length` response header instead, which is
// exactly what a real player already reads.
const CONTAINER = "yourtal-rustfs";
const LOG_FILE = "/logs/rustfs.log";

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", CONTAINER, "sh", "-c", script], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

/** Bytes already in the log before this test's own fetches, so a rerun (or
 * another suite sharing this container) never reads someone else's records. */
function logSizeBytes(): number {
  const wc = inContainer(`wc -c < ${LOG_FILE} 2>/dev/null || echo 0`);
  return Number(wc.trim()) || 0;
}

beforeAll(async () => {
  await publishFixture();
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
      // own header comment: RustFS's INFO-level record has no byte count of
      // its own, so the ceiling's ↓N half comes from here).
      expect(delivered.get(index)).toBeGreaterThan(0);
    }

    // And the segment nobody asked for has no record. Without this the test
    // would pass against a log that recorded everything indiscriminately,
    // which would prove the opposite of attributable delivery.
    expect(records.some((line) => line.includes("segment1.ts"))).toBe(false);
    expect(records.some((line) => line.includes("segment3.ts"))).toBe(false);
  });
});
