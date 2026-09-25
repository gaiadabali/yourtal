import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MoneyAmount } from "./money-amount";

describe("MoneyAmount", () => {
  it("renders AUD minor units against Intl's own en-AU output", () => {
    const { container } = render(<MoneyAmount amountMinor={450} currency="AUD" />);
    const expected = new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(4.5);
    expect(container.textContent).toBe(expected);
  });

  it("renders IDR with zero decimals against Intl's own id-ID output", () => {
    const { container } = render(<MoneyAmount amountMinor={25000} currency="IDR" locale="id-ID" />);
    const expected = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(25000);
    expect(container.textContent).toBe(expected);
  });

  it("never does float arithmetic beyond the display divide", () => {
    // 12345 minor units (AUD) is exactly $123.45 - no rounding drift.
    const { container } = render(<MoneyAmount amountMinor={12345} currency="AUD" />);
    expect(container.textContent).toContain("123.45");
  });
});
