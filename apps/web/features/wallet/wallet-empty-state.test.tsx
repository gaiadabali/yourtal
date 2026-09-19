import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WalletEmptyState } from "./wallet-empty-state";

describe("WalletEmptyState", () => {
  it("teaches how to earn instead of showing a bare zero", () => {
    render(<WalletEmptyState />);

    expect(screen.queryByText(/^0 poin$/)).not.toBeInTheDocument();
    expect(screen.getByText(/menonton video/)).toBeInTheDocument();
  });

  it("links straight into the Earn board so the loop is one tap away", () => {
    render(<WalletEmptyState />);

    const link = screen.getByRole("link", { name: /Earn/ });
    expect(link).toHaveAttribute("href", "/");
  });
});
