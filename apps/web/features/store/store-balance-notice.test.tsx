import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { toPoints } from "@yourtal/contracts/money";
import { StoreBalanceNotice } from "./store-balance-notice";

describe("StoreBalanceNotice", () => {
  it("states the exact shortfall and offers ways to earn more when the balance is insufficient", () => {
    render(
      <StoreBalanceNotice
        priceInPoints={toPoints(1_500_000)}
        availablePoints={toPoints(8_400)}
        locale="id-ID"
      />,
    );
    expect(screen.getByText(/kurang 1\.491\.600 poin lagi/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /earn/i })).toHaveAttribute("href", "/home");
    expect(screen.getByRole("link", { name: /quick/i })).toHaveAttribute("href", "/quick");
  });

  it("confirms the balance is sufficient and does not show earn links when affordable", () => {
    render(
      <StoreBalanceNotice
        priceInPoints={toPoints(2_000)}
        availablePoints={toPoints(8_400)}
        locale="id-ID"
      />,
    );
    expect(screen.getByText(/saldo kamu cukup/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("StoreBalanceNotice (en-AU, YT-0405)", () => {
  it("states the exact shortfall naturally ('you need N more points'), not a word-for-word translation", () => {
    render(
      <StoreBalanceNotice
        priceInPoints={toPoints(1_500_000)}
        availablePoints={toPoints(8_400)}
        locale="en-AU"
      />,
    );
    expect(screen.getByText("You need 1,491,600 more points.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /earn/i })).toHaveAttribute("href", "/home");
    expect(screen.getByRole("link", { name: /quick/i })).toHaveAttribute("href", "/quick");
  });

  it("confirms sufficiency in English with no Indonesian copy leaking through", () => {
    render(
      <StoreBalanceNotice
        priceInPoints={toPoints(2_000)}
        availablePoints={toPoints(8_400)}
        locale="en-AU"
      />,
    );
    expect(screen.getByText(/you have enough/i)).toBeInTheDocument();
    expect(screen.queryByText(/saldo|cukup/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bpoin\b/i)).not.toBeInTheDocument();
  });
});
