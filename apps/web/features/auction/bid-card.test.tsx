import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enAuction from "@/messages/en-AU/auction.json";
import idAuction from "@/messages/id-ID/auction.json";
import { BidCard } from "./bid-card";
import { needsCardToBid } from "./bid-card-rules";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./auction-actions", () => ({ startBidCardAction: vi.fn() }));

const AUCTION = "0b5f1c9e-2f43-4d8e-9a55-7a1c2d3e4f50";
const SAVED = { brand: "visa", last4: "4242", expMonth: 12, expYear: 2034 };

function show(
  props: Partial<React.ComponentProps<typeof BidCard>>,
  locale: "en-AU" | "id-ID" = "en-AU",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ auction: locale === "en-AU" ? enAuction : idAuction }}
    >
      <BidCard auctionId={AUCTION} card={{ card: null, required: true }} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("the card a bid holds (5.1.d)", () => {
  it("asks for a card where one is required and none is saved, naming the auction it returns to", () => {
    const { container } = show({});
    expect(screen.getByRole("button", { name: "Add a card to bid" })).toBeInTheDocument();
    expect(screen.getByText(/only charged if you win/)).toBeInTheDocument();
    expect(container.querySelector('input[name="auctionId"]')).toHaveValue(AUCTION);
    expect(needsCardToBid({ card: null, required: true })).toBe(true);
  });

  it("shows the saved card's brand and last four, and offers to replace it", () => {
    show({ card: { card: SAVED, required: true } });
    expect(
      screen.getByText("Bids use your Visa ending in 4242, expires 12/34."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace card" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a card to bid" })).not.toBeInTheDocument();
    expect(needsCardToBid({ card: SAVED, required: true })).toBe(false);
  });

  it("shows nothing where no card is needed (Indonesia), or when the card could not be read", () => {
    const { container, rerender } = show({ card: { card: null, required: false } });
    expect(container).toBeEmptyDOMElement();
    rerender(
      <NextIntlClientProvider locale="en-AU" messages={{ auction: enAuction }}>
        <BidCard auctionId={AUCTION} card={null} />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(needsCardToBid({ card: null, required: false })).toBe(false);
    expect(needsCardToBid(null)).toBe(false);
  });

  it.each([
    ["saved", "Saving your card. This usually takes a few seconds."],
    ["cancelled", "No card was saved."],
    ["failed", "We couldn't open the card page. Try again."],
  ])("says so when the processor's page returns %s", (outcome, text) => {
    show({ outcome });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("confirms a card that has arrived", () => {
    show({ card: { card: SAVED, required: true }, outcome: "saved" });
    expect(screen.getByText("Card saved. You can bid now.")).toBeInTheDocument();
  });

  it("speaks Indonesian to an Indonesian viewer", () => {
    show({}, "id-ID");
    expect(
      screen.getByRole("button", { name: "Tambahkan kartu untuk menawar" }),
    ).toBeInTheDocument();
  });
});
