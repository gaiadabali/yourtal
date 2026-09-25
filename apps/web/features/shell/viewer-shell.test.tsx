import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ViewerShell } from "./viewer-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("ViewerShell", () => {
  it("is dark by default and sets data-surface for the token system", () => {
    const { container } = render(
      <ViewerShell locale="en-AU" availablePoints={8400}>
        <p>content</p>
      </ViewerShell>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute("data-surface", "viewer");
    expect(root).toHaveAttribute("data-theme", "dark");
  });

  it("accepts a light theme override", () => {
    const { container } = render(
      <ViewerShell locale="en-AU" availablePoints={0} theme="light">
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
    expect(screen.getByRole("link", { name: "YourTal" })).toHaveAttribute("href", "/");
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
    expect(screen.getAllByText("Watch")[0]).toBeInTheDocument();
  });
});
