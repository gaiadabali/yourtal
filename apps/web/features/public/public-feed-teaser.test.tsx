import "@testing-library/jest-dom/vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PublicFeedTeaser } from "./public-feed-teaser";
import type { PublicFeedTeaserViewItem } from "./public-feed-view";

const playMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const pauseMock = vi.fn<() => void>();

const ITEMS: PublicFeedTeaserViewItem[] = [
  {
    id: "campaign-1",
    href: "/au/c/campaign-1",
    merchantName: "Warung Kopi",
    title: "Behind the roast",
    poster: "https://cdn.example.com/poster-1.jpg",
    teaser: "https://cdn.example.com/teaser-1.mp4",
    termsLabel: "18 min · 3 questions · up to 112 pts · ~120 MB · finish to earn",
  },
  {
    id: "campaign-2",
    href: "/au/c/campaign-2",
    merchantName: "Toko Roti",
    title: "Fresh from the oven",
    poster: "https://cdn.example.com/poster-2.jpg",
    teaser: "https://cdn.example.com/teaser-2.mp4",
    termsLabel: "45 sec · No questions · up to 20 pts · ~8 MB · finish to earn",
  },
];

describe("PublicFeedTeaser (11.1.b)", () => {
  beforeAll(() => {
    window.HTMLMediaElement.prototype.play = playMock;
    window.HTMLMediaElement.prototype.pause = pauseMock;
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("renders every item's title, merchant, honest terms and a Sign up to earn link", () => {
    render(
      <PublicFeedTeaser
        items={ITEMS}
        landmarkLabel="For you"
        endHeading="You're all caught up"
        playLabel="Play video"
        pauseLabel="Pause video"
        signUpHref="/onboarding"
        signUpCta="Sign up to earn"
      />,
    );

    expect(screen.getByRole("region", { name: "For you" })).toBeInTheDocument();
    expect(screen.getByText("Behind the roast")).toBeInTheDocument();
    expect(screen.getByText("Fresh from the oven")).toBeInTheDocument();
    expect(
      screen.getByText("18 min · 3 questions · up to 112 pts · ~120 MB · finish to earn"),
    ).toBeInTheDocument();
    const signUpLinks = screen.getAllByRole("link", { name: "Sign up to earn" });
    expect(signUpLinks.length).toBeGreaterThan(0);
    for (const link of signUpLinks) {
      expect(link).toHaveAttribute("href", "/onboarding");
    }
  });

  it("links each card to its own campaign page", () => {
    render(
      <PublicFeedTeaser
        items={ITEMS}
        landmarkLabel="For you"
        endHeading="You're all caught up"
        playLabel="Play video"
        pauseLabel="Pause video"
        signUpHref="/onboarding"
        signUpCta="Sign up to earn"
      />,
    );
    const region = screen.getByRole("region", { name: "For you" });
    const cardOne = within(region).getByText("Behind the roast").closest("[data-vf-index]");
    expect(cardOne?.querySelector("a[href='/au/c/campaign-1']")).toBeTruthy();
  });

  it("renders the end-of-feed panel", () => {
    render(
      <PublicFeedTeaser
        items={ITEMS}
        landmarkLabel="For you"
        endHeading="You're all caught up"
        playLabel="Play video"
        pauseLabel="Pause video"
        signUpHref="/onboarding"
        signUpCta="Sign up to earn"
      />,
    );
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });
});
