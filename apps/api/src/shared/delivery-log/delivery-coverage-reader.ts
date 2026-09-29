import type { Pool } from "pg";
import type { DeliveryCoverageReader, DeliveryCoverageVerdict } from "../../modules/watch/delivery-coverage";

/**
 * TASKS.md 10.4.c (EW-18): the real `DeliveryCoverageReader` —
 * `apps/api/src/modules/watch/delivery-coverage.ts`'s own header names this
 * as "not built yet, and area A's". Not wired into `WatchModule` here: that
 * swap (`StubDeliveryCoverageReader` -> this class) is 11.5.f's, alongside
 * binding the verdict into completion (B's file, B's phase). This class
 * only has to exist and be correct so that swap is a one-line DI change.
 *
 * Narrow, read-only SQL against `watch.coverage` — the same "own narrow SQL,
 * never edit the owning module" convention `staff-suspension-repository.ts`
 * already follows for a table outside its own module.
 *
 * # What "matches" means
 *
 * The session's CLAIMED coverage (`watch.coverage`, merged into whole-second
 * spans) must be covered by the SERVED segments `platform.delivery_log`
 * recorded (apps/worker's `delivery-log-ingest.ts`), each one assumed to
 * span `SEGMENT_SECONDS` seconds from its index — the same duration
 * `packages/media`'s ffmpeg-transcode.ts config asks ffmpeg for. That
 * constant is not exported there (packages/media is Area C's), so it is
 * restated here rather than imported; a v1 heuristic that never gates a
 * reward can afford to fall out of sync for a day if that number ever
 * changes, which is what the comment is for.
 */
const SEGMENT_SECONDS = 6;

/** Half-open `[from, to)` whole-second spans, merged and sorted. */
type Span = readonly [number, number];

function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const [from, to] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && from <= last[1]) {
      merged[merged.length - 1] = [last[0], Math.max(last[1], to)];
    } else {
      merged.push([from, to]);
    }
  }
  return merged;
}

/** True when every claimed span is covered by the served spans. */
export function claimedIsCoveredByServed(claimed: readonly Span[], served: readonly Span[]): boolean {
  const mergedServed = mergeSpans(served);
  return mergeSpans(claimed).every(([from, to]) =>
    mergedServed.some(([servedFrom, servedTo]) => servedFrom <= from && to <= servedTo),
  );
}

export class RealDeliveryCoverageReader implements DeliveryCoverageReader {
  constructor(private readonly pool: Pool) {}

  async deliveryCoverage(sessionId: string): Promise<DeliveryCoverageVerdict> {
    const servedRows = await this.pool.query<{ segment_index: number }>(
      `SELECT DISTINCT segment_index FROM platform.delivery_log
        WHERE session_id = $1 AND segment_index IS NOT NULL AND status_code = 200`,
      [sessionId],
    );
    // Nothing ingested yet for this session — the log may not have rotated
    // in, or this ran before 11.5.f wires it into a real completion. Not
    // the same thing as "a gap": say so plainly rather than guessing.
    if (servedRows.rows.length === 0) return "unknown";

    const claimedRows = await this.pool.query<{ from_second: number; to_second: number }>(
      `SELECT from_second, to_second FROM watch.coverage WHERE session_id = $1`,
      [sessionId],
    );
    const claimed: Span[] = claimedRows.rows.map((row) => [row.from_second, row.to_second]);
    const served: Span[] = servedRows.rows.map((row) => [
      row.segment_index * SEGMENT_SECONDS,
      (row.segment_index + 1) * SEGMENT_SECONDS,
    ]);

    return claimedIsCoveredByServed(claimed, served) ? "matches" : "gap_detected";
  }
}
