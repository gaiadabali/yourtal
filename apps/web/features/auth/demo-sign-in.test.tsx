import { afterEach, describe, expect, it, vi } from "vitest";

/** Staging test kit: off staging the sign-in page shows no demo list and never asks the API. */
describe("DemoSignIn", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/api/api-fetch");
  });

  it.each(["dev", "production", ""])("APP_ENV=%s: renders nothing, calls nothing", async (env) => {
    vi.stubEnv("APP_ENV", env);
    const apiFetch = vi.fn();
    vi.resetModules();
    vi.doMock("@/lib/api/api-fetch", () => ({ apiFetch }));
    const { DemoSignIn } = await import("./demo-sign-in");
    expect(await DemoSignIn({})).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("on staging, renders nothing when the API does not offer the list", async () => {
    vi.stubEnv("APP_ENV", "staging");
    const apiFetch = vi.fn(() =>
      Promise.resolve({ ok: false, error: { kind: "http", status: 404, code: "http_404" } }),
    );
    vi.resetModules();
    vi.doMock("@/lib/api/api-fetch", () => ({ apiFetch }));
    const { DemoSignIn } = await import("./demo-sign-in");
    expect(await DemoSignIn({})).toBeNull();
    expect(apiFetch).toHaveBeenCalledOnce();
  });
});
