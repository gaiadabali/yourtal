import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 13.3.c: every data-source switch a page uses picks live in a deployed build.
 * The modules read APP_ENV at load, so each is loaded fresh under the env.
 */
describe.each(["staging", "production"])("APP_ENV=%s", (appEnv) => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("the shared switch resolves live", async () => {
    vi.stubEnv("APP_ENV", appEnv);
    const { dataSourceMode } = await import("@yourtal/contracts/mock-source");
    expect(dataSourceMode).toBe("live");
  });

  it("the Studio switch resolves live", async () => {
    vi.stubEnv("APP_ENV", appEnv);
    const { resolveStudioDataSourceMode } = await import("@/features/studio/studio-data-source");
    expect(resolveStudioDataSourceMode({ APP_ENV: appEnv })).toBe("live");
  });
});
