import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Heading } from "./heading";

describe("Heading", () => {
  it("renders the requested outline level", () => {
    render(<Heading level={2}>Rewards</Heading>);
    const heading = screen.getByRole("heading", { level: 2, name: "Rewards" });
    expect(heading.tagName).toBe("H2");
  });

  it("lets size differ from level", () => {
    render(
      <Heading level={1} size="title">
        Small h1
      </Heading>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Small h1" });
    expect(heading.className).toContain("text-title");
  });

  it("uses the display face for display and headline sizes", () => {
    render(
      <Heading level={2} size="headline">
        Big h2
      </Heading>,
    );
    expect(screen.getByRole("heading", { level: 2 }).className).toContain("font-display");
  });
});
