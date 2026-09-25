import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Notice } from "./notice";

describe("Notice", () => {
  it("uses role status for info and success", () => {
    render(<Notice tone="info">Your points are on the way</Notice>);
    expect(screen.getByRole("status")).toBeInTheDocument();

    render(<Notice tone="success">Redeemed</Notice>);
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("uses role alert for warning and danger", () => {
    render(<Notice tone="warning">Offer expires soon</Notice>);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    render(<Notice tone="danger">Redemption failed</Notice>);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("renders an optional title and action", () => {
    render(
      <Notice tone="info" title="Heads up" action={<button type="button">Dismiss</button>}>
        Details here
      </Notice>,
    );
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Details here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});
