import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ViewerShell } from "./viewer-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("ViewerShell", () => {
  it("follows the document's theme by default and sets data-surface for the token system", () => {
    const { container } = render(
      <ViewerShell locale="en-AU" availablePoints={8400}>
        <p>content</p>
      </ViewerShell>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute("data-surface", "viewer");
    expect(root).not.toHaveAttribute("data-theme");
  });

  it("accepts a pinned theme", () => {
    const { container } = render(
      <ViewerShell locale="en-AU" availablePoints={0} forceTheme="light">
        <p>content</p>
      </ViewerShell>,
    );
    expect(container.firstChild).toHaveAttribute("data-theme", "light");
  });

  it("renders the wordmark linking home, a labelled search field and the points chip", () => {
    render(
      <ViewerShell locale="en-AU" availablePoints={8400}>
        <p>content</p>
      </ViewerShell>,
    );
    // Two wordmarks: the header's below lg, the side rail's from lg (13.18.a).
    for (const link of screen.getAllByRole("link", { name: "YourTal" })) {
      expect(link).toHaveAttribute("href", "/home");
    }
    expect(screen.getByRole("searchbox", { name: "Search YourTal" })).toHaveAttribute("name", "q");
    expect(screen.getByLabelText("8,400 points available")).toBeInTheDocument();
  });

  it("localises the search field and points chip for id-ID", () => {
    render(
      <ViewerShell locale="id-ID" availablePoints={8400}>
        <p>content</p>
      </ViewerShell>,
    );
    expect(screen.getByRole("searchbox", { name: "Cari di YourTal" })).toBeInTheDocument();
    expect(screen.getByText("8.400")).toBeInTheDocument();
  });

  it("renders the five tabs, Home through Me, with no link to /business anywhere", () => {
    render(
      <ViewerShell locale="en-AU" availablePoints={0}>
        <p>content</p>
      </ViewerShell>,
    );
    const navs = screen.getAllByRole("navigation", { name: "Primary" });
    expect(navs).toHaveLength(2); // bottom nav + side rail, CSS picks one per viewport
    for (const nav of navs) {
      const links = nav.querySelectorAll("a");
      expect(links).toHaveLength(5);
      for (const link of links) {
        expect(link.getAttribute("href") ?? "").not.toMatch(/^\/business/);
      }
    }
    expect(screen.getAllByText("Home")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Shorts")[0]).toBeInTheDocument();
  });

  describe("signedOut (F79/11.1.d)", () => {
    const signedOut = {
      homeHref: "/au",
      hrefs: {
        home: "/au",
        shorts: "/login?returnTo=%2Fshorts",
        store: "/au/rewards",
        wallet: "/login?returnTo=%2Fwallet",
        me: "/login?returnTo=%2Fme",
      },
      signUpHref: "/onboarding",
      signUpLabel: "Sign up to earn",
    };

    it("shows the sign-up CTA instead of the points chip, and no search form", () => {
      render(
        <ViewerShell locale="en-AU" availablePoints={0} signedOut={signedOut}>
          <p>content</p>
        </ViewerShell>,
      );
      expect(screen.getByRole("link", { name: "Sign up to earn" })).toHaveAttribute(
        "href",
        "/onboarding",
      );
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/points available/)).not.toBeInTheDocument();
    });

    it("links the wordmark at the public locale root, not /home", () => {
      render(
        <ViewerShell locale="en-AU" availablePoints={0} signedOut={signedOut}>
          <p>content</p>
        </ViewerShell>,
      );
      for (const link of screen.getAllByRole("link", { name: "YourTal" })) {
        expect(link).toHaveAttribute("href", "/au");
      }
    });

    it("points Home and Store at their own public destinations, and Shorts/Wallet/Me at sign-in", () => {
      render(
        <ViewerShell locale="en-AU" availablePoints={0} signedOut={signedOut}>
          <p>content</p>
        </ViewerShell>,
      );
      const navs = screen.getAllByRole("navigation", { name: "Primary" });
      for (const nav of navs) {
        const links = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
        expect(links).toEqual([
          "/au",
          "/login?returnTo=%2Fshorts",
          "/au/rewards",
          "/login?returnTo=%2Fwallet",
          "/login?returnTo=%2Fme",
        ]);
      }
    });

    it("renders exactly as before when signedOut is omitted (no regression for existing callers)", () => {
      render(
        <ViewerShell locale="en-AU" availablePoints={8400}>
          <p>content</p>
        </ViewerShell>,
      );
      expect(screen.getByLabelText("8,400 points available")).toBeInTheDocument();
      expect(screen.getByRole("searchbox", { name: "Search YourTal" })).toBeInTheDocument();
    });
  });
});
