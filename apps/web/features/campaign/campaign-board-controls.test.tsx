import "@testing-library/jest-dom/vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CampaignBoardControls } from "./campaign-board-controls";

const push = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
  useSearchParams: () => searchParams,
}));

// jsdom implements neither pointer capture nor scrollIntoView, both of which
// Radix Select's internal pointer/keyboard handling calls unconditionally.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  push.mockClear();
  searchParams = new URLSearchParams();
});

describe("CampaignBoardControls", () => {
  // The kind filter is a set of links (it changes the URL, it does not swap an
  // in-page panel), so these assert the href each one points at rather than a
  // mocked router call — the URL is the actual contract.
  it("renders a link for every kind filter option and a labelled sort combobox", () => {
    render(<CampaignBoardControls />);
    expect(screen.getByRole("navigation", { name: /filter jenis campaign/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Semua" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("combobox", { name: /urutkan campaign/i })).toBeInTheDocument();
  });

  it("points each kind filter at a URL carrying that filter, preserving the pathname", () => {
    render(<CampaignBoardControls />);
    expect(screen.getByRole("link", { name: "Cepat" })).toHaveAttribute("href", "/?kind=quick");
  });

  it("reads its initial kind selection from the URL rather than defaulting blind", () => {
    searchParams = new URLSearchParams("kind=long_form");
    render(<CampaignBoardControls />);
    expect(screen.getByRole("link", { name: "Video panjang" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Semua" })).not.toHaveAttribute("aria-current");
  });

  it("preserves the existing sort value when only the kind filter changes", () => {
    searchParams = new URLSearchParams("sort=reward");
    render(<CampaignBoardControls />);
    expect(screen.getByRole("link", { name: "Cepat" })).toHaveAttribute("href", "/?sort=reward&kind=quick");
  });

  it("navigates via router.push when the sort select changes", async () => {
    render(<CampaignBoardControls />);
    fireEvent.change(screen.getByRole("combobox", { name: /urutkan campaign/i }), {
      target: { value: "reward" },
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/?sort=reward"));
  });
});
