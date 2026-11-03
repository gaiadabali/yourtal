import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

import SignupRedirectPage from "./page";

describe("/signup", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("redirects to /register", async () => {
    await expect(SignupRedirectPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT:/register",
    );
  });

  it("keeps a safe returnTo and drops an unsafe one", async () => {
    await expect(
      SignupRedirectPage({ searchParams: Promise.resolve({ returnTo: "/watch/abc" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/register?returnTo=%2Fwatch%2Fabc");
    await expect(
      SignupRedirectPage({ searchParams: Promise.resolve({ returnTo: "//evil.test" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/register");
    expect(redirect).toHaveBeenLastCalledWith("/register");
  });
});
