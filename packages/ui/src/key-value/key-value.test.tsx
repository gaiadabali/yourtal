import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KeyValue } from "./key-value";

const items = [
  { key: "balance", label: "Points balance", value: "1,240" },
  { key: "tier", label: "Tier", value: "Gold" },
];

describe("KeyValue", () => {
  it("renders a definition list", () => {
    const { container } = render(<KeyValue items={items} />);
    expect(container.querySelector("dl")).toBeInTheDocument();
    expect(container.querySelectorAll("dt")).toHaveLength(2);
    expect(container.querySelectorAll("dd")).toHaveLength(2);
  });

  it("renders each label and value", () => {
    render(<KeyValue items={items} />);
    expect(screen.getByText("Points balance")).toBeInTheDocument();
    expect(screen.getByText("1,240")).toBeInTheDocument();
    expect(screen.getByText("Tier")).toBeInTheDocument();
    expect(screen.getByText("Gold")).toBeInTheDocument();
  });

  it("supports the stacked layout", () => {
    const { container } = render(<KeyValue items={items} layout="stacked" />);
    expect(container.querySelector("dl > div")).toHaveClass("flex-col");
  });
});
