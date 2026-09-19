import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublicBreadcrumbs } from "./public-breadcrumbs";

describe("PublicBreadcrumbs", () => {
  const items = [
    { name: "Home", url: "https://yourtal.com/id" },
    { name: "Rewards catalogue", url: "https://yourtal.com/id/rewards" },
    { name: "Voucher Kopi Sentosa", url: "https://yourtal.com/id/rewards/kopi-sentosa/abc" },
  ];

  it("exposes a labelled navigation landmark with a link per non-final crumb", () => {
    render(<PublicBreadcrumbs items={items} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rewards catalogue" })).toBeInTheDocument();
  });

  it("marks the final crumb as the current page, not a link", () => {
    render(<PublicBreadcrumbs items={items} />);
    const current = screen.getByText("Voucher Kopi Sentosa");
    expect(current.tagName).toBe("SPAN");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("emits a BreadcrumbList JSON-LD block built from the same items", () => {
    const { container } = render(<PublicBreadcrumbs items={items} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    const jsonLd = JSON.parse(script?.innerHTML ?? "{}") as { itemListElement: { name: string }[] };
    expect(jsonLd.itemListElement.map((item) => item.name)).toEqual(items.map((item) => item.name));
  });
});
