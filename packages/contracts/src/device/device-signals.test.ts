import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CLOCK_SKEW_SIGNAL_THRESHOLD_MS,
  type ClientReportedSignals,
  type DeviceSignalCollector,
  type DeviceSignalReport,
  clockSkewMs,
} from "./device-signals";

function clientSignals(collectedAt: string): ClientReportedSignals {
  return {
    fingerprint: { hash: "abc123", inputCount: 12 },
    automation: { webdriverFlag: false, headlessHints: 0, inconsistencyHints: 0 },
    collectedAt,
  };
}

const SERVER_NOW = new Date("2026-09-22T12:00:00.000Z");

describe("clockSkewMs", () => {
  it("is zero when the clocks agree", () => {
    expect(clockSkewMs(clientSignals("2026-09-22T12:00:00.000Z"), SERVER_NOW)).toBe(0);
  });

  it("measures the distance in either direction", () => {
    const behind = clockSkewMs(clientSignals("2026-09-22T11:58:00.000Z"), SERVER_NOW);
    const ahead = clockSkewMs(clientSignals("2026-09-22T12:02:00.000Z"), SERVER_NOW);

    expect(behind).toBe(2 * 60 * 1000);
    // A client clock running FAST is at least as interesting as one running
    // slow -- a replayed payload can carry either -- so the measure is
    // absolute and the two must come out equal.
    expect(ahead).toBe(behind);
  });

  /**
   * The failure this function exists to avoid.
   *
   * An unparseable timestamp is the shape a hand-crafted or truncated
   * payload arrives in. If it returned 0 -- which is what falling back to
   * "no difference" would give -- a garbage value would read as PERFECT
   * clock agreement and score better than an honest client whose laptop is
   * four minutes out. Failing to the maximum is the only direction that
   * cannot be exploited by sending less.
   */
  it("treats an unparseable timestamp as maximally skewed, never as agreement", () => {
    const skew = clockSkewMs(clientSignals("not-a-timestamp"), SERVER_NOW);

    expect(skew).toBe(Number.POSITIVE_INFINITY);
    expect(skew).not.toBe(0);
    expect(skew).toBeGreaterThan(CLOCK_SKEW_SIGNAL_THRESHOLD_MS);
  });

  it("treats an empty timestamp the same way", () => {
    expect(clockSkewMs(clientSignals(""), SERVER_NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it("does not fire on ordinary unsynchronised-clock drift", () => {
    // A minute out is a normal laptop, not a signal.
    const ordinary = clockSkewMs(clientSignals("2026-09-22T11:59:00.000Z"), SERVER_NOW);
    expect(ordinary).toBeLessThan(CLOCK_SKEW_SIGNAL_THRESHOLD_MS);
  });
});

describe("provenance is preserved in the types", () => {
  /**
   * The central property of this module, asserted at the type level because
   * that is where it is enforced: a report cannot be assembled from client
   * claims alone. If someone later makes `server` optional to make a call
   * site easier, this fails the build -- which is the entire point, since
   * the runtime consequence would be a risk score silently computed from
   * attacker-controlled input.
   */
  it("cannot build a report without the server-observed half", () => {
    const clientOnly = {
      platform: "web" as const,
      client: clientSignals(SERVER_NOW.toISOString()),
    };

    expectTypeOf(clientOnly).not.toExtend<DeviceSignalReport>();
    expectTypeOf<DeviceSignalReport>().toHaveProperty("server");
    expectTypeOf<DeviceSignalReport>().toHaveProperty("client");
  });

  /**
   * A collector returns the client half only. It runs where the client runs
   * and cannot observe its own ASN, so anything it reported about the
   * network would be a client claim wearing a server-observed name.
   */
  it("a collector cannot return server-observed signals", () => {
    expectTypeOf<
      DeviceSignalCollector["collect"]
    >().returns.resolves.toEqualTypeOf<ClientReportedSignals>();
    expectTypeOf<ClientReportedSignals>().not.toHaveProperty("asn");
    expectTypeOf<ClientReportedSignals>().not.toHaveProperty("abuseScore");
  });

  it("names both platforms so a native build is distinguishable from a web one", () => {
    expectTypeOf<DeviceSignalCollector["platform"]>().toEqualTypeOf<"web" | "native">();
  });
});
