import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { CharityPayouts } from "@yourtal/contracts/billing/payouts";
import enAU from "@/messages/en-AU/charity.json";
import { CharityPayoutsNotice, CharityPayoutsPanel } from "./charity-payouts-panel";

vi.mock("./charity-payouts-action", () => ({ startCharityPayoutLinkAction: vi.fn() }));

const t = createTranslator({
  locale: "en-AU",
  messages: { charity: enAU },
  namespace: "charity",
} as never) as unknown as (key: string, values?: Record<string, string | number>) => string;

const account = (
  state: "not_started" | "in_progress" | "ready",
  available = true,
): CharityPayouts => ({
  account: {
    available,
    state,
    bankLast4: state === "ready" ? "3456" : null,
    hostedOnboarding: true,
  },
});

describe("CharityPayoutsPanel (5.2)", () => {
  it("asks a new charity to set up payouts and explains why", () => {
    render(<CharityPayoutsPanel charityId="c1" payouts={account("not_started")} t={t} />);
    expect(screen.getByRole("button", { name: "Set up payouts" })).toBeInTheDocument();
    expect(
      screen.getByText("Auctions in Australia need payouts set up first."),
    ).toBeInTheDocument();
  });

  it("offers to finish a setup in progress", () => {
    render(<CharityPayoutsPanel charityId="c1" payouts={account("in_progress")} t={t} />);
    expect(screen.getByRole("button", { name: "Finish setting up" })).toBeInTheDocument();
  });

  it("shows the last four of a ready account", () => {
    render(<CharityPayoutsPanel charityId="c1" payouts={account("ready")} t={t} />);
    expect(
      screen.getByText("Auction proceeds are paid to the account ending ••3456"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update bank details" })).toBeInTheDocument();
  });

  it("is not shown where payouts are not available", () => {
    const { container } = render(
      <CharityPayoutsPanel charityId="c1" payouts={account("not_started", false)} t={t} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["returned", "in_progress", "Thanks — we're checking your payout details."],
    ["returned", "ready", "Payouts are set up."],
    ["error", "not_started", "The payout details page could not be opened. Try again."],
  ] as const)("notice for %s with a %s account", (outcome, state, text) => {
    render(<CharityPayoutsNotice outcome={outcome} payouts={account(state)} t={t} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
