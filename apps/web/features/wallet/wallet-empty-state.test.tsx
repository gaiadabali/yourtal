import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WalletEmptyState } from "./wallet-empty-state";
import { walletTestTranslator } from "./wallet-test-translator";

/**
 * `WalletEmptyState` (like every rewritten screen in this feature) is an
 * async Server Component that calls `getTranslations("wallet")` — mocked
 * here to the real catalogue via `walletTestTranslator` (see that file's
 * doc comment) rather than a real next-intl request context, which does
 * not exist in a plain vitest+jsdom run. Called directly and awaited
 * (`await WalletEmptyState()`) rather than rendered as JSX, since a plain
 * client renderer cannot resolve an async function component on its own.
 */
let locale: "en-AU" | "id-ID" = "id-ID";
vi.mock("next-intl/server", () => ({
  getTranslations: () => walletTestTranslator(locale),
}));

describe("WalletEmptyState (id-ID)", () => {
  it("teaches how to earn instead of showing a bare zero", async () => {
    locale = "id-ID";
    render(await WalletEmptyState());

    expect(screen.queryByText(/^0 poin$/)).not.toBeInTheDocument();
    expect(screen.getByText(/menonton video/)).toBeInTheDocument();
  });

  it("links straight into the Earn board so the loop is one tap away", async () => {
    locale = "id-ID";
    render(await WalletEmptyState());

    const link = screen.getByRole("link", { name: /Earn/ });
    expect(link).toHaveAttribute("href", "/home");
  });
});

describe("WalletEmptyState (en-AU)", () => {
  it("teaches how to earn in English, with no Indonesian copy leaking through", async () => {
    locale = "en-AU";
    const { container } = render(await WalletEmptyState());

    expect(screen.getByText(/watching short videos/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Find a video in Earn/ })).toHaveAttribute(
      "href",
      "/home",
    );
    expect(container.textContent).not.toMatch(/\bpoin\b|menonton/i);
  });
});
