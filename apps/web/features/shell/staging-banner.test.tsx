import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import { StagingBanner } from "./staging-banner";
import { isStaging } from "./app-env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("staging posture", () => {
  it("is off unless APP_ENV is staging", () => {
    vi.stubEnv("APP_ENV", "dev");
    expect(isStaging()).toBe(false);
    vi.stubEnv("APP_ENV", "staging");
    expect(isStaging()).toBe(true);
  });

  it("renders the banner in the document's language", () => {
    render(<StagingBanner lang="id-ID" />);
    expect(screen.getByRole("complementary").textContent).toContain("pembayaran disimulasikan");
  });

  it("falls back to English for an unknown lang", () => {
    render(<StagingBanner lang="fr-FR" />);
    expect(screen.getByRole("complementary").textContent).toContain("payments simulated");
  });

  it("keeps every crawler out on staging", () => {
    vi.stubEnv("APP_ENV", "staging");
    expect(robots().rules).toStrictEqual({ userAgent: "*", disallow: "/" });
    vi.stubEnv("APP_ENV", "dev");
    expect(robots().rules).not.toStrictEqual({ userAgent: "*", disallow: "/" });
  });
});
