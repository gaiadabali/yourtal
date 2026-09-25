import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Section } from "./section";

describe("Section", () => {
  it("wires the region's accessible name to its heading", () => {
    render(<Section title="Recent activity">body</Section>);
    const region = screen.getByRole("region", { name: "Recent activity" });
    expect(region.tagName).toBe("SECTION");
  });

  it("renders description and action", () => {
    render(
      <Section
        title="Rewards"
        description="Latest offers"
        action={<button type="button">See all</button>}
      >
        body
      </Section>,
    );
    expect(screen.getByText("Latest offers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See all" })).toBeInTheDocument();
  });

  it("renders children inside the section", () => {
    render(<Section title="Rewards">body content</Section>);
    expect(screen.getByText("body content")).toBeInTheDocument();
  });
});
