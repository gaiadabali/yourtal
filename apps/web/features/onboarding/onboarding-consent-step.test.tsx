import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/onboarding.json";
import { OnboardingConsentStep } from "./onboarding-consent-step";
import { recordOnboardingConsentAction } from "./onboarding-actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./onboarding-actions", () => ({ recordOnboardingConsentAction: vi.fn() }));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ onboarding: enAU }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("OnboardingConsentStep", () => {
  it("essential has no switch; the two optional purposes start from the caller's real recorded state", () => {
    renderWithIntl(
      <OnboardingConsentStep
        initialConsents={[
          {
            purpose: "declared_interest_targeting",
            state: "granted",
            recordedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        returnTo={null}
      />,
    );
    expect(screen.queryByRole("switch", { name: /account and fraud prevention/i })).toBeNull();
    expect(screen.getByRole("switch", { name: "Personalise which campaigns I see" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Send me marketing messages" })).not.toBeChecked();
  });

  it("records a real POST with source: onboarding on toggle", async () => {
    vi.mocked(recordOnboardingConsentAction).mockResolvedValue({
      ok: true,
      data: { consents: [] },
    });
    const user = userEvent.setup();
    renderWithIntl(<OnboardingConsentStep initialConsents={[]} returnTo={null} />);

    await user.click(screen.getByRole("switch", { name: "Send me marketing messages" }));

    expect(recordOnboardingConsentAction).toHaveBeenCalledWith("marketing_communications", true);
  });

  it("continuing to interests when ad-targeting was granted", async () => {
    vi.mocked(recordOnboardingConsentAction).mockResolvedValue({
      ok: true,
      data: {
        consents: [
          {
            purpose: "declared_interest_targeting",
            state: "granted",
            recordedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderWithIntl(<OnboardingConsentStep initialConsents={[]} returnTo="/watch/campaign-1" />);

    await user.click(screen.getByRole("switch", { name: "Personalise which campaigns I see" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(push).toHaveBeenCalledWith("/onboarding/interests?returnTo=%2Fwatch%2Fcampaign-1");
  });

  it("continuing straight to follow when ad-targeting was never granted", async () => {
    const user = userEvent.setup();
    renderWithIntl(<OnboardingConsentStep initialConsents={[]} returnTo={null} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(push).toHaveBeenCalledWith("/onboarding/follow");
  });
});
