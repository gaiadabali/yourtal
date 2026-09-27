import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/onboarding.json";
import { OnboardingFollowStep } from "./onboarding-follow-step";
import { followBusinessAction, unfollowBusinessAction } from "./onboarding-actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./onboarding-actions", () => ({
  followBusinessAction: vi.fn(),
  unfollowBusinessAction: vi.fn(),
}));

const CANDIDATES = [
  {
    id: "biz-1",
    displayName: "Toko Berkah",
    handle: "toko-berkah",
    logoUrl: null,
    region: "ID" as const,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en-AU" messages={{ onboarding: enAU }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("OnboardingFollowStep", () => {
  it("shows an empty state when there is nothing in the caller's region to follow yet", () => {
    renderWithIntl(<OnboardingFollowStep candidates={[]} returnTo={null} />);
    expect(screen.getByText("Nothing to follow yet")).toBeInTheDocument();
  });

  it("follows a real business on tap (PUT /api/me/follows/:id) and flips to Following", async () => {
    vi.mocked(followBusinessAction).mockResolvedValue({ ok: true, data: { following: true } });
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFollowStep candidates={CANDIDATES} returnTo={null} />);

    await user.click(screen.getByRole("button", { name: "Follow" }));

    expect(followBusinessAction).toHaveBeenCalledWith("biz-1");
    expect(screen.getByRole("button", { name: "Following" })).toBeInTheDocument();
  });

  it("unfollows again on a second tap", async () => {
    vi.mocked(followBusinessAction).mockResolvedValue({ ok: true, data: { following: true } });
    vi.mocked(unfollowBusinessAction).mockResolvedValue({ ok: true, data: { following: false } });
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFollowStep candidates={CANDIDATES} returnTo={null} />);

    await user.click(screen.getByRole("button", { name: "Follow" }));
    await user.click(screen.getByRole("button", { name: "Following" }));

    expect(unfollowBusinessAction).toHaveBeenCalledWith("biz-1");
  });

  it("never blocks: continuing with nothing followed still advances", async () => {
    const user = userEvent.setup();
    renderWithIntl(<OnboardingFollowStep candidates={CANDIDATES} returnTo="/watch/campaign-1" />);

    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(push).toHaveBeenCalledWith("/onboarding/done?returnTo=%2Fwatch%2Fcampaign-1");
  });
});
