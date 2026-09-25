import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the title as a heading and the description", () => {
    render(
      <EmptyState title="No rewards yet" description="Watch a video to earn your first points" />,
    );
    expect(screen.getByRole("heading", { name: "No rewards yet" })).toBeInTheDocument();
    expect(screen.getByText("Watch a video to earn your first points")).toBeInTheDocument();
  });

  it("hides the icon slot from assistive tech", () => {
    render(<EmptyState title="No rewards yet" icon={<svg data-testid="icon" />} />);
    expect(screen.getByTestId("icon").parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the action slot", () => {
    render(
      <EmptyState title="No rewards yet" action={<button type="button">Browse brands</button>} />,
    );
    expect(screen.getByRole("button", { name: "Browse brands" })).toBeInTheDocument();
  });
});
