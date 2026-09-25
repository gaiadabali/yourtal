import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Card, CardContent, CardDescription, CardTarget, CardTitle } from "./card";

describe("Card", () => {
  it("renders its title and description as plain content", () => {
    render(
      <Card>
        <CardTitle>Warung Bu Sri</CardTitle>
        <CardContent>
          <CardDescription>2,000 pts to redeem</CardDescription>
        </CardContent>
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Warung Bu Sri" })).toBeInTheDocument();
    expect(screen.getByText("2,000 pts to redeem")).toBeInTheDocument();
  });

  it("lets an interactive card expose a single accessible, clickable target", () => {
    const onClick = vi.fn();
    render(
      <Card variant="interactive">
        <CardTarget aria-label="Open Warung Bu Sri" onClick={onClick} />
        <CardTitle>Warung Bu Sri</CardTitle>
      </Card>,
    );
    const target = screen.getByRole("button", { name: "Open Warung Bu Sri" });
    fireEvent.click(target);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the interactive target as a link via asChild", () => {
    render(
      <Card variant="interactive">
        <CardTarget asChild>
          <a href="/store/1" aria-label="Open listing" />
        </CardTarget>
        <CardTitle>Listing</CardTitle>
      </Card>,
    );
    const link = screen.getByRole("link", { name: "Open listing" });
    expect(link.tagName).toBe("A");
  });
});
