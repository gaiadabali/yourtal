/**
 * The segment-log cross-check completion asks for (5.1.d, 10.4.c).
 *
 * `deliveryCoverage(sessionId)` is meant to answer "did the CDN actually
 * serve the segments this session's claimed coverage implies" — the other
 * half of YT-0220 alongside signed segment URLs, and the audit's
 * §3.8/§3.10's "no delivery-log writer exists, and no cross-check exists"
 * finding. That writer is 10.4.c, not built yet, and area A's.
 *
 * This interface exists so `WatchController.complete` can call it and
 * carry the result on the completion response WITHOUT gating on it — an
 * `"unknown"` answer must never refuse or delay a reward, only be surfaced
 * for whoever reviews fraud later. Delete `StubDeliveryCoverageReader` and
 * swap in the real one once 10.4.c lands.
 */
export type DeliveryCoverageVerdict = "matches" | "gap_detected" | "unknown";

export interface DeliveryCoverageReader {
  deliveryCoverage(sessionId: string): Promise<DeliveryCoverageVerdict>;
}

export const DELIVERY_COVERAGE_READER = Symbol("DELIVERY_COVERAGE_READER");

export class StubDeliveryCoverageReader implements DeliveryCoverageReader {
  deliveryCoverage(): Promise<DeliveryCoverageVerdict> {
    return Promise.resolve("unknown");
  }
}
