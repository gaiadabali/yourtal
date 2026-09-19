import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoreEmptyState } from "./store-empty-state";

describe("StoreEmptyState", () => {
  it("offers a reset action when filters narrowed the grid to nothing", () => {
    render(<StoreEmptyState hasActiveFilters />);
    expect(screen.getByRole("link", { name: /hapus semua filter/i })).toHaveAttribute("href", "/store");
  });

  it("does not offer a reset action when no filter is narrowing the grid", () => {
    render(<StoreEmptyState hasActiveFilters={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
