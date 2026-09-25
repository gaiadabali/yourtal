import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilterBar } from "./filter-bar";

describe("FilterBar", () => {
  it("renders its filter control children", () => {
    render(
      <FilterBar>
        <button type="button">Category</button>
        <button type="button">Region</button>
      </FilterBar>,
    );
    expect(screen.getByRole("button", { name: "Category" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Region" })).toBeInTheDocument();
  });

  it("renders an optional clear action after the filters", () => {
    render(
      <FilterBar clearAction={<button type="button">Clear</button>}>
        <button type="button">Category</button>
      </FilterBar>,
    );
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("allows horizontal scroll and wraps on wider screens", () => {
    const { container } = render(
      <FilterBar>
        <button type="button">Category</button>
      </FilterBar>,
    );
    expect(container.firstChild).toHaveClass("overflow-x-auto", "md:flex-wrap");
  });
});
