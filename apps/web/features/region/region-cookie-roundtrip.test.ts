import { describe, expect, it, vi } from "vitest";

import { ONBOARDING_REGION_COOKIE } from "../onboarding/onboarding-region-cookie";
import { REGION_COOKIE_NAME } from "./region-cookie";

/**
 * Cross-feature invariant: what onboarding WRITES is what the app READS.
 *
 * The region picker (YT-0430) sets a cookie; `getRegion()` (YT-0405) reads
 * it and every screen's currency, number formatting and copy follow from the
 * result. They are separate features, written by separate agents.
 *
 * The failure mode if they disagree is silent, which is why this test
 * exists: `getRegion()` would simply not find the cookie and fall back to the
 * default region. Nothing throws. An Australian user completes onboarding,
 * picks Australia, and is shown Rupiah — and every unit test in both features
 * still passes, because each is individually correct.
 */
describe("region cookie round-trip between onboarding and the region reader", () => {
  it("writes and reads the same cookie name", () => {
    expect(ONBOARDING_REGION_COOKIE).toBe(REGION_COOKIE_NAME);
  });

  it("resolves the region that onboarding wrote, rather than the default", async () => {
    // Australia specifically: "ID" is the fallback, so a bug that loses the
    // cookie entirely would still pass if this asserted "ID".
    vi.doMock("next/headers", () => ({
      cookies: () =>
        Promise.resolve({
          get: (name: string) => (name === ONBOARDING_REGION_COOKIE ? { value: "AU" } : undefined),
        }),
    }));

    const { getRegion } = await import("./get-region");
    expect(await getRegion()).toBe("AU");
    vi.doUnmock("next/headers");
  });

  it("falls back to the default when no cookie has been written yet", async () => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({
      cookies: () => Promise.resolve({ get: () => undefined }),
    }));

    const { getRegion } = await import("./get-region");
    expect(await getRegion()).toBe("ID");
    vi.doUnmock("next/headers");
  });
});
