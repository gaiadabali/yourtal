import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaCard } from "./media-card";

const baseProps = {
  poster: "https://example.com/poster.jpg",
  posterAlt: "A barista pouring coffee",
  aspect: "16:9" as const,
  title: "How we roast our beans",
};

describe("MediaCard", () => {
  it("renders the poster image with its alt text and the title", () => {
    render(<MediaCard {...baseProps} />);
    expect(screen.getByAltText("A barista pouring coffee")).toBeInTheDocument();
    expect(screen.getByText("How we roast our beans")).toBeInTheDocument();
  });

  it("renders the duration badge when given", () => {
    render(<MediaCard {...baseProps} durationLabel="2:14" />);
    expect(screen.getByText("2:14")).toBeInTheDocument();
  });

  it("renders as a link when href is given, as the sole interactive target", () => {
    render(<MediaCard {...baseProps} href="/watch/123" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/watch/123");
  });

  it("renders as a button and fires onClick when given", async () => {
    const onClick = vi.fn();
    render(<MediaCard {...baseProps} onClick={onClick} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });

  it("renders a static, non-interactive card when neither href nor onClick is given", () => {
    render(<MediaCard {...baseProps} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("exposes the progress bar with its required accessible label", () => {
    render(<MediaCard {...baseProps} progress={0.4} progressLabel="40% watched" />);
    const bar = screen.getByRole("progressbar", { name: "40% watched" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
  });

  it("renders the channel and reward slots", () => {
    render(
      <MediaCard
        {...baseProps}
        channel={<span>Bali Coffee Co</span>}
        reward={<span>+50 pts</span>}
      />,
    );
    expect(screen.getByText("Bali Coffee Co")).toBeInTheDocument();
    expect(screen.getByText("+50 pts")).toBeInTheDocument();
  });
});
