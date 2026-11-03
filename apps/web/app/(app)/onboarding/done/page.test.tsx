import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/me.json";
import enOnboarding from "@/messages/en-AU/onboarding.json";
import type * as OnboardingData from "@/features/onboarding/onboarding-data";

const { getMeProfile } = vi.hoisted(() => ({ getMeProfile: vi.fn() }));
vi.mock("@/features/me/me-data", () => ({ getMeProfile }));
vi.mock("@/features/onboarding/onboarding-data", async (importOriginal) => ({
  ...(await importOriginal<typeof OnboardingData>()),
  getOnboardingConsents: () => Promise.resolve({ ok: true, data: { consents: [] } }),
}));
vi.mock("@/features/player/identity-check-actions", () => ({
  requestEmailVerificationAction: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));
vi.mock("@/features/onboarding/onboarding-timing-mark", () => ({
  OnboardingTimingMark: () => null,
}));

import OnboardingDonePage from "./page";

async function renderPage() {
  const ui = await OnboardingDonePage({ searchParams: Promise.resolve({}) });
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ me: enAU, onboarding: enOnboarding }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const me = (extra: object) => ({
  ok: true,
  data: { profile: {}, businessMemberships: [], staffRoles: [], ...extra },
});

beforeEach(() => {
  getMeProfile.mockReset();
});

describe("/onboarding/done reminder", () => {
  it("nudges an account whose email is not verified yet", async () => {
    getMeProfile.mockResolvedValue(me({ email: "mei@example.com", emailVerified: false }));
    await renderPage();
    expect(screen.getByText("Verify your email to start earning points")).toBeInTheDocument();
  });

  it("stays quiet for a verified email and when the read fails", async () => {
    getMeProfile.mockResolvedValue(me({ email: "mei@example.com", emailVerified: true }));
    const first = await renderPage();
    expect(screen.queryByText("Verify your email to start earning points")).not.toBeInTheDocument();
    first.unmount();

    getMeProfile.mockResolvedValue({ ok: false, error: { kind: "network", message: "x" } });
    await renderPage();
    expect(screen.queryByText("Verify your email to start earning points")).not.toBeInTheDocument();
  });
});
