import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Text } from "./text";

describe("Text", () => {
  it("renders a <p> by default", () => {
    render(<Text>Hello</Text>);
    expect(screen.getByText("Hello").tagName).toBe("P");
  });

  it("renders the requested element", () => {
    render(<Text as="label">Points earned</Text>);
    expect(screen.getByText("Points earned").tagName).toBe("LABEL");
  });

  it("applies the tone and size classes", () => {
    render(
      <Text as="span" size="caption" tone="danger">
        Error
      </Text>,
    );
    const el = screen.getByText("Error");
    expect(el.className).toContain("text-caption");
    expect(el.className).toContain("text-danger-solid");
  });

  it("applies tabular numerals when numeric", () => {
    render(<Text numeric>1,234</Text>);
    expect(screen.getByText("1,234").className).toContain("text-numeric");
  });
});
