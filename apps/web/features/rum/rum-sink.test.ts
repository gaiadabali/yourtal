import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRumSample } from "./rum-report";
import { sendRumSample } from "./rum-sink";

const sample = buildRumSample({
  metric: "LCP",
  value: 1800,
  country: "ID",
  connectionType: "4g",
  deviceClass: "mid",
  pathname: "/",
  now: new Date("2026-09-20T12:00:00.000Z"),
});

describe("sendRumSample", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("never throws, even if console itself throws (telemetry must not break the page)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "debug").mockImplementation(() => {
      throw new Error("console is broken");
    });
    expect(() => sendRumSample(sample)).not.toThrow();
  });

  it("logs in development so the pipeline is visibly wired end to end", () => {
    vi.stubEnv("NODE_ENV", "development");
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    sendRumSample(sample);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("is silent in production — there is nowhere real to send a sample yet (see this file's doc comment)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    sendRumSample(sample);
    expect(spy).not.toHaveBeenCalled();
  });
});
