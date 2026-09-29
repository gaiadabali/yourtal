import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  longMerchantNameCampaignFixture,
  zeroRewardCampaignFixture,
} from "@yourtal/contracts/campaign/mock";
import type { Campaign } from "@yourtal/contracts/campaign";
import { publicLocaleConfig } from "./public-locale";
import { PublicCampaignContent } from "./public-campaign-content";

describe("PublicCampaignContent", () => {
  it("shows the title as the page heading and links the merchant name", () => {
    render(
      <PublicCampaignContent
        campaign={longMerchantNameCampaignFixture}
        accuracyBonusPoints={0}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/warung-kopi-kenangan-manis-nusantara-jaya-abadi-sentosa-cabang-kebayoran-baru"
        watchHref={`/id/c/${longMerchantNameCampaignFixture.id}/watch`}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: longMerchantNameCampaignFixture.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: longMerchantNameCampaignFixture.merchantName }),
    ).toHaveAttribute(
      "href",
      "/id/m/warung-kopi-kenangan-manis-nusantara-jaya-abadi-sentosa-cabang-kebayoran-baru",
    );
  });

  it("names the sign-up call to action's reward and duration in the same sentence", () => {
    render(
      <PublicCampaignContent
        campaign={longMerchantNameCampaignFixture}
        accuracyBonusPoints={0}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/x"
        watchHref={`/id/c/${longMerchantNameCampaignFixture.id}/watch`}
      />,
    );
    const cta = screen.getByRole("link", { name: /daftar untuk mulai dapat poin/i });
    // 11.2.b: sign-up returns to the SAME campaign, never a bare /onboarding.
    expect(cta).toHaveAttribute(
      "href",
      `/onboarding?returnTo=${encodeURIComponent(`/watch/${longMerchantNameCampaignFixture.id}`)}`,
    );
    // The reward and duration appear together in one sentence in the CTA body, not just the fact table.
    expect(
      screen.getByText("Tonton video 30 detik ini dan dapatkan 150 poin setelah kamu mendaftar."),
    ).toBeInTheDocument();
  });

  it("links the honest secondary path into anonymous Open Viewing (YT-0432), for an open_viewing all_ages campaign", () => {
    // 11.2.b: F8's own rule — the link only ever appears for a campaign that
    // has opted in AND is rated all_ages. `longMerchantNameCampaignFixture`
    // does not (its own next test covers that "sign in to watch" case).
    const eligibleCampaign: Campaign = {
      ...longMerchantNameCampaignFixture,
      openViewing: true,
      audience: "all_ages",
    };
    render(
      <PublicCampaignContent
        campaign={eligibleCampaign}
        accuracyBonusPoints={0}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/x"
        watchHref={`/id/c/${eligibleCampaign.id}/watch`}
      />,
    );
    expect(screen.getByRole("link", { name: /tonton tanpa mendaftar/i })).toHaveAttribute(
      "href",
      `/id/c/${eligibleCampaign.id}/watch`,
    );
  });

  it("shows a sign-in note instead of the anonymous link for a campaign that has not opted into Open Viewing", () => {
    render(
      <PublicCampaignContent
        campaign={longMerchantNameCampaignFixture}
        accuracyBonusPoints={0}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/x"
        watchHref={`/id/c/${longMerchantNameCampaignFixture.id}/watch`}
      />,
    );
    expect(screen.queryByRole("link", { name: /tonton tanpa mendaftar/i })).not.toBeInTheDocument();
    expect(screen.getByText(/hanya tersedia untuk pengguna yang sudah masuk/i)).toBeInTheDocument();
  });

  it("still states a zero reward plainly rather than hiding the row", () => {
    render(
      <PublicCampaignContent
        campaign={zeroRewardCampaignFixture}
        accuracyBonusPoints={0}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/x"
        watchHref={`/id/c/${zeroRewardCampaignFixture.id}/watch`}
      />,
    );
    expect(screen.getByText("0 poin")).toBeInTheDocument();
  });

  it("shows a not-live notice and no sign-up or watch CTA for a paused or ended campaign", () => {
    const pausedCampaign: Campaign = { ...longMerchantNameCampaignFixture, status: "paused" };
    render(
      <PublicCampaignContent
        campaign={pausedCampaign}
        accuracyBonusPoints={0}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/x"
        watchHref={`/id/c/${pausedCampaign.id}/watch`}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /daftar untuk mulai dapat poin/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /tonton tanpa mendaftar/i })).not.toBeInTheDocument();
    expect(screen.getByText(/tidak aktif/i)).toBeInTheDocument();
  });
});
