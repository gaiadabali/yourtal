import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { toPoints } from "@yourtal/contracts/money";
import { StoreBalanceNotice } from "./store-balance-notice";

describe("StoreBalanceNotice", () => {
  it("states the exact shortfall and offers ways to earn more when the balance is insufficient", () => {
    render(<StoreBalanceNotice priceInPoints={toPoints(1_500_000)} availablePoints={toPoints(8_400)} />);
    expect(screen.getByText(/kurang 1\.491\.600 poin lagi/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /earn/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /quick/i })).toHaveAttribute("href", "/quick");
  });

  it("confirms the balance is sufficient and does not show earn links when affordable", () => {
    render(<StoreBalanceNotice priceInPoints={toPoints(2_000)} availablePoints={toPoints(8_400)} />);
    expect(screen.getByText(/saldo kamu cukup/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
