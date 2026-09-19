import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublicOgCard } from "./public-og-card";

describe("PublicOgCard", () => {
  it("renders the reward line naming reward and duration together, never just the title", () => {
    render(
      <PublicOgCard
        eyebrow="Sponsored video"
        title="Promo Kilat"
        merchantName="Warung Kopi Kenangan"
        rewardLine="150 poin · 30 detik"
      />,
    );
    expect(screen.getByText("Promo Kilat")).toBeInTheDocument();
    expect(screen.getByText("Warung Kopi Kenangan")).toBeInTheDocument();
    expect(screen.getByText("150 poin · 30 detik")).toBeInTheDocument();
  });
});
