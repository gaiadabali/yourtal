import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WalletEmptyState } from "./wallet-empty-state";

describe("WalletEmptyState (id-ID)", () => {
  it("teaches how to earn instead of showing a bare zero", () => {
    render(<WalletEmptyState locale="id-ID" />);

    expect(screen.queryByText(/^0 poin$/)).not.toBeInTheDocument();
    expect(screen.getByText(/menonton video/)).toBeInTheDocument();
  });

  it("links straight into the Earn board so the loop is one tap away", () => {
    render(<WalletEmptyState locale="id-ID" />);

    const link = screen.getByRole("link", { name: /Earn/ });
    expect(link).toHaveAttribute("href", "/");
  });
});

describe("WalletEmptyState (en-AU, YT-0405)", () => {
  it("teaches how to earn in English, with no Indonesian copy leaking through", () => {
    const { container } = render(<WalletEmptyState locale="en-AU" />);

    expect(screen.getByText(/watching short videos/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Find a video in Earn/ })).toHaveAttribute("href", "/");
    expect(container.textContent).not.toMatch(/\bpoin\b|menonton/i);
  });
});
