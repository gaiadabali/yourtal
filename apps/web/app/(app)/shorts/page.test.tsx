import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import feedMessages from "@/messages/en-AU/feed.json";
import type { ShortsFeedData } from "@/features/feed/feed-data";
import ShortsPage from "./page";

const mocks = vi.hoisted(() => ({ getShortsFeed: vi.fn() }));

vi.mock("@/features/feed/feed-data", () => ({ getShortsFeed: mocks.getShortsFeed }));
vi.mock("@/features/region/get-region", () => ({ getRegion: () => Promise.resolve("AU") }));
vi.mock("@/i18n/get-locale", () => ({ getDisplayLocale: () => Promise.resolve("en-AU") }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: (namespace: "feed") =>
      Promise.resolve(
        createTranslator({ locale: "en-AU", messages: { feed: feedMessages }, namespace }),
      ),
  };
});
// The feed itself is covered in shorts-feed.test.tsx; this file is about which state the page picks.
vi.mock("@/features/feed/shorts-feed", () => ({
  ShortsFeed: ({ data }: { data: ShortsFeedData }) => (
    <div data-testid="shorts-feed">{String(data.items.length)} shorts</div>
  ),
}));

const data = (overrides: Partial<ShortsFeedData> = {}): ShortsFeedData => ({
  signedOut: false,
  items: [],
  savedIds: [],
  earnedToday: 0,
  autoplay: "always",
  ageBand: "adult",
  ...overrides,
});

async function renderPage() {
  render(
    <NextIntlClientProvider locale="en-AU" messages={{ feed: feedMessages }}>
      {await ShortsPage()}
    </NextIntlClientProvider>,
  );
}

afterEach(() => vi.resetAllMocks());

// 5.6.c: signed out, /shorts showed the error state because the feed call lacked a region.
describe("the Shorts page", () => {
  it("shows a visitor the Open Viewing Shorts", async () => {
    mocks.getShortsFeed.mockResolvedValue({
      ok: true,
      data: data({ signedOut: true, items: [{ campaignId: "a" }] as never }),
    });
    await renderPage();
    expect(screen.getByTestId("shorts-feed")).toHaveTextContent("1 shorts");
    expect(screen.queryByText("Your feed didn't load")).not.toBeInTheDocument();
  });

  it("shows a visitor the empty state with the sign-up prompt when there are none, never the error state", async () => {
    mocks.getShortsFeed.mockResolvedValue({ ok: true, data: data({ signedOut: true }) });
    await renderPage();
    expect(screen.getByText("No Shorts right now")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up to earn" })).toHaveAttribute(
      "href",
      "/register?returnTo=%2Fshorts",
    );
    expect(screen.queryByText("Your feed didn't load")).not.toBeInTheDocument();
  });

  it("shows a member with no Shorts the plain empty state, without a sign-up prompt", async () => {
    mocks.getShortsFeed.mockResolvedValue({ ok: true, data: data() });
    await renderPage();
    expect(screen.getByText("No Shorts right now")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign up to earn" })).not.toBeInTheDocument();
  });

  it("keeps the error state for a feed that could not be read", async () => {
    mocks.getShortsFeed.mockResolvedValue({ ok: false });
    await renderPage();
    expect(screen.getByText("Your feed didn't load")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/shorts");
  });
});
