import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/onboarding.json";
import { OnboardingInterestsStep } from "./onboarding-interests-step";
import { updateInterestsAction } from "@/features/me/me-actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/me/me-actions", () => ({ updateInterestsAction: vi.fn() }));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ onboarding: enAU }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("OnboardingInterestsStep", () => {
  it("shows Skip for now with nothing selected, and the real taxonomy's own labels", () => {
    renderWithIntl(<OnboardingInterestsStep initialNodeIds={[]} returnTo={null} />);
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
    expect(screen.getByText("Food and drink")).toBeInTheDocument();
  });

  it("saves live on toggle (PUT /api/me/interests, reused from Me) and switches to Continue", async () => {
    vi.mocked(updateInterestsAction).mockResolvedValue({ ok: true, data: { nodeIds: ["fashion"] } });
    const user = userEvent.setup();
    renderWithIntl(<OnboardingInterestsStep initialNodeIds={[]} returnTo={null} />);

    await user.click(screen.getByRole("checkbox", { name: "Fashion" }));

    expect(updateInterestsAction).toHaveBeenCalledWith(["fashion"]);
    expect(await screen.findByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("continues on to the follow step, carrying a validated returnTo forward", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OnboardingInterestsStep initialNodeIds={["fashion"]} returnTo="/watch/campaign-1" />,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(push).toHaveBeenCalledWith("/onboarding/follow?returnTo=%2Fwatch%2Fcampaign-1");
  });
});
