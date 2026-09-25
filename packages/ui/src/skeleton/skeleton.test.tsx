import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("is hidden from the accessibility tree, since it carries no information", () => {
    const { container } = render(<Skeleton className="h-4 w-32" data-testid="placeholder" />);
    const el = container.querySelector('[data-testid="placeholder"]');
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("forwards the caller's sizing classes", () => {
    const { container } = render(<Skeleton className="h-4 w-32" data-testid="placeholder" />);
    const el = container.querySelector('[data-testid="placeholder"]');
    expect(el).toHaveClass("h-4", "w-32");
  });
});
