import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CampaignEmptyState } from "./campaign-empty-state";

describe("CampaignEmptyState", () => {
  it("names the active filter rather than showing a generic 'no results' message", () => {
    render(<CampaignEmptyState kind="quick" locale="id-ID" />);
    expect(screen.getByText(/campaign cepat/i)).toBeInTheDocument();
  });

  it("offers a next action that clears the filter", () => {
    render(<CampaignEmptyState kind="long_form" locale="id-ID" />);
    expect(screen.getByRole("link", { name: /tampilkan semua campaign/i })).toHaveAttribute(
      "href",
      "/home",
    );
  });

  it("does not offer a 'show all' action when no filter is narrowing the board", () => {
    render(<CampaignEmptyState kind="all" locale="id-ID" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
