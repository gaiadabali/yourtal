import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn<(path: string, ...rest: unknown[]) => Promise<unknown>>());
vi.mock("@/lib/api/api-fetch", () => ({ apiFetch }));

/** The live data source is picked at import time, so load a fresh copy of the module in live mode. */
async function liveData() {
  vi.stubEnv("YOURTAL_DATA_SOURCE", "live");
  vi.resetModules();
  return import("./billing-data");
}

beforeEach(() => apiFetch.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("billing data, live (14.13)", () => {
  it("buys a package by tier key, not by points", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { message: "stop" } });
    const { purchasePoints } = await liveData();
    await expect(purchasePoints("b1", "grow", "AUD", "k1")).rejects.toThrow("Could not buy");
    expect(apiFetch).toHaveBeenCalledWith("/api/b1/studio/billing/purchases", expect.anything(), {
      method: "POST",
      headers: { "idempotency-key": "k1" },
      body: { tierKey: "grow", currency: "AUD" },
    });
  });

  it("reads the packages and the alerts from their own endpoints", async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, data: { packages: [{ tierKey: "grow" }] } })
      .mockResolvedValueOnce({ ok: true, data: { alerts: [{ id: "a1" }] } });
    const { listPackages, getAlerts } = await liveData();
    expect(await listPackages("b1", "AUD")).toEqual([{ tierKey: "grow" }]);
    expect(await getAlerts("b1")).toEqual([{ id: "a1" }]);
    expect(apiFetch.mock.calls.map((call) => call[0])).toEqual([
      "/api/b1/studio/billing/packages",
      "/api/b1/studio/billing/alerts",
    ]);
  });

  it("shows no alerts, rather than breaking the page, when the alerts cannot be read", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { message: "down" } });
    const { getAlerts } = await liveData();
    expect(await getAlerts("b1")).toEqual([]);
  });
});
