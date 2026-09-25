import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PageContainer } from "./page-container";

describe("PageContainer", () => {
  it("defaults to the default width", () => {
    const { container } = render(<PageContainer>content</PageContainer>);
    expect(container.firstChild).toHaveClass("max-w-page");
  });

  it("applies narrow and wide width tiers", () => {
    const narrow = render(<PageContainer width="narrow">content</PageContainer>);
    expect(narrow.container.firstChild).toHaveClass("max-w-page-narrow");

    const wide = render(<PageContainer width="wide">content</PageContainer>);
    expect(wide.container.firstChild).toHaveClass("max-w-page-wide");
  });

  it("applies responsive gutters", () => {
    const { container } = render(<PageContainer>content</PageContainer>);
    expect(container.firstChild).toHaveClass("px-gutter-sm", "md:px-gutter-md", "lg:px-gutter-lg");
  });
});
