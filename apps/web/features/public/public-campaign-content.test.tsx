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
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/x"
        watchHref={`/id/c/${longMerchantNameCampaignFixture.id}/watch`}
      />,
    );
    const cta = screen.getByRole("link", { name: /daftar untuk mulai dapat poin/i });
    expect(cta).toHaveAttribute("href", "/onboarding");
    // The reward and duration appear together in one sentence in the CTA body, not just the fact table.
    expect(
      screen.getByText("Tonton video 30 detik ini dan dapatkan 150 poin setelah kamu mendaftar."),
    ).toBeInTheDocument();
  });

  it("links the honest secondary path into anonymous Open Viewing (YT-0432), for a live campaign only", () => {
    render(
      <PublicCampaignContent
        campaign={longMerchantNameCampaignFixture}
        locale={publicLocaleConfig("id")}
        merchantHref="/id/m/x"
        watchHref={`/id/c/${longMerchantNameCampaignFixture.id}/watch`}
      />,
    );
    expect(screen.getByRole("link", { name: /tonton tanpa mendaftar/i })).toHaveAttribute(
      "href",
      `/id/c/${longMerchantNameCampaignFixture.id}/watch`,
    );
  });

  it("still states a zero reward plainly rather than hiding the row", () => {
    render(
      <PublicCampaignContent
        campaign={zeroRewardCampaignFixture}
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
