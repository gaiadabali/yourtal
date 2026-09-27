import { describe, expect, it } from "vitest";
import { readCachedQrWindows, writeCachedQrWindows } from "./voucher-qr-idb-cache";

/**
 * jsdom (this suite's test environment) does not implement IndexedDB at
 * all — `typeof indexedDB === "undefined"` here, the same as a browser with
 * it disabled or a private-mode tab that blocks it. Every call must
 * therefore degrade to "no cache" rather than throwing; this is the one
 * thing a unit test in this environment can actually prove about this
 * module (the real read/write round trip is exercised by
 * `e2e/b-wallet-voucher.spec.ts` against a real browser, per 6.5.c).
 */
describe("voucher-qr-idb-cache (no IndexedDB in this environment)", () => {
  it("readCachedQrWindows resolves to null instead of throwing", async () => {
    await expect(readCachedQrWindows("voucher-1")).resolves.toBeNull();
  });

  it("writeCachedQrWindows resolves instead of throwing", async () => {
    await expect(
      writeCachedQrWindows({
        voucherId: "voucher-1",
        windows: [{ token: "t", expiresAt: new Date().toISOString() }],
        cachedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});
