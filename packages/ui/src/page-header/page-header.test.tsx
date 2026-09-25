import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders the title as a heading", () => {
    render(<PageHeader title="Rewards" />);
    expect(screen.getByRole("heading", { name: "Rewards" })).toBeInTheDocument();
  });

  it("renders the description when given", () => {
    render(<PageHeader title="Rewards" description="Redeem your points" />);
    expect(screen.getByText("Redeem your points")).toBeInTheDocument();
  });

  it("renders back and actions slots", () => {
    render(
      <PageHeader
        title="Rewards"
        back={<a href="/">Back</a>}
        actions={<button type="button">Filter</button>}
      />,
    );
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
  });

  it("uses the requested heading level", () => {
    render(<PageHeader title="Section" level={2} />);
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeInTheDocument();
  });
});
