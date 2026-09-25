import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorState } from "./error-state";

describe("ErrorState", () => {
  it("is announced as an alert", () => {
    render(<ErrorState title="Couldn't load rewards" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders the title, description and retry action", () => {
    render(
      <ErrorState
        title="Couldn't load rewards"
        description="Check your connection and try again"
        retry={<button type="button">Retry</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Couldn't load rewards" })).toBeInTheDocument();
    expect(screen.getByText("Check your connection and try again")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
