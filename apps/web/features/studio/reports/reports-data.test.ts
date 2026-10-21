import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 5.13.a: the live Reports bundle reads only the zones the viewer's role may
 * see. Finance may not read campaigns and a marketer may not read the store's
 * listings; either read is a 403, which used to throw the whole page.
 */
const paths: string[] = [];
vi.mock("@/lib/api/api-fetch", () => ({
  apiFetch: vi.fn((path: string) => {
    paths.push(path);
    if (path.endsWith("/studio/campaigns")) return Promise.resolve({ ok: true, data: [] });
    if (path.endsWith("/store/listings"))
      return Promise.resolve({ ok: true, data: { listings: [] } });
    if (path.endsWith("/studio/reports/vouchers")) return Promise.resolve({ ok: true, data: {} });
    return Promise.resolve({
      ok: false,
      error: { kind: "http", status: 403, message: "forbidden" },
    });
  }),
}));

async function liveBundle() {
  vi.resetModules();
  vi.stubEnv("YOURTAL_DATA_SOURCE", "live");
  return import("./reports-data");
}

beforeEach(() => {
  paths.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const BIZ = "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10";

describe("getReportsBundle (live) reads only what the role may see", () => {
  it("finance: no campaigns, no question banks, no listings; the voucher report still loads", async () => {
    const { getReportsBundle } = await liveBundle();
    const bundle = await getReportsBundle(BIZ, "Acme", { campaigns: false, inventory: false });
    expect(paths).toEqual([`/api/${BIZ}/studio/reports/vouchers`]);
    expect(bundle.campaigns).toEqual([]);
    expect(bundle.listings).toEqual([]);
  });

  it("a marketer: campaigns but not the store's listings", async () => {
    const { getReportsBundle } = await liveBundle();
    await getReportsBundle(BIZ, "Acme", { campaigns: true, inventory: false });
    expect(paths).toContain(`/api/${BIZ}/studio/campaigns`);
    expect(paths).not.toContain(`/api/${BIZ}/store/listings`);
  });

  it("an owner: everything", async () => {
    const { getReportsBundle } = await liveBundle();
    await getReportsBundle(BIZ, "Acme", { campaigns: true, inventory: true });
    expect(paths).toEqual(
      expect.arrayContaining([
        `/api/${BIZ}/studio/campaigns`,
        `/api/${BIZ}/store/listings`,
        `/api/${BIZ}/studio/reports/vouchers`,
      ]),
    );
  });
});
