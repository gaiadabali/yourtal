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

const CONTAINER = "yourtal-minio";
const TRACE_FILE = "/tmp/yourtal-segment-trace.log";

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", CONTAINER, "sh", "-c", script], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

beforeAll(async () => {
  await publishFixture();
  // `mc admin trace` needs admin credentials; the image's stock `local` alias
  // has none, and fails with an unparseable-response error that says nothing
  // about credentials. Idempotent.
  inContainer(`mc alias set yt http://127.0.0.1:9000 yourtal yourtal_local_only >/dev/null 2>&1`);
});

describe("per-segment delivery logging", () => {
  it("records one request per segment fetched, with the bytes delivered", async () => {
    // Detached, self-terminating: a trace left running outlives the test and
    // the next run reads its output instead of its own.
    inContainer(
      `rm -f ${TRACE_FILE}; (timeout 12 mc admin trace --path '/yourtal-media/hls/*' yt > ${TRACE_FILE} 2>&1 &) ; sleep 1`,
    );

    const fetched = [0, 2, 4];
    for (const index of fetched) {
      const response = await fetch(segmentUrl(FIXTURE_ASSET_ID, index));
      expect(response.ok).toBe(true);
      await response.arrayBuffer();
    }

    // The trace is a stream; give MinIO a moment to flush before reading.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const trace = inContainer(`cat ${TRACE_FILE} 2>/dev/null || true`);
    inContainer(`pkill -f 'mc admin trace' >/dev/null 2>&1; rm -f ${TRACE_FILE}`);

    const records = trace
      .split(/\r?\n/)
      .filter((line) => line.includes("s3.GetObject") && line.includes(FIXTURE_ASSET_ID));

    // One record per segment actually requested — the per-segment granularity
    // Cloudflare Stream does not offer at any price.
    expect(records.length).toBeGreaterThanOrEqual(fetched.length);

    for (const index of fetched) {
      const forSegment = records.filter((line) => line.includes(`segment${String(index)}.ts`));
      expect(
        forSegment.length,
        `no delivery record for segment${String(index)}.ts; trace was:\n${trace}`,
      ).toBeGreaterThanOrEqual(1);
      // Bytes delivered are on the record, which is what makes it a ceiling
      // on what a client can claim to have watched.
      expect(forSegment.some((line) => /↓\s*\d+(\.\d+)?\s*(B|KiB|MiB)/.test(line))).toBe(true);
    }

    // And the segment nobody asked for has no record. Without this the test
    // would pass against a trace that logged everything indiscriminately,
    // which would prove the opposite of attributable delivery.
    expect(records.some((line) => line.includes("segment1.ts"))).toBe(false);
    expect(records.some((line) => line.includes("segment3.ts"))).toBe(false);
  });
});
