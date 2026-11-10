import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MinorUnits, Points } from "@yourtal/contracts/money";
import type { ListingPriceRow } from "@yourtal/contracts/staff/economy";
import enStaff from "@/messages/en-AU/staff.json";
import idStaff from "@/messages/id-ID/staff.json";
import { StaffListingPricesScreen } from "./staff-listing-prices-screen";
import {
  decideListingPriceAction,
  proposeListingPriceAction,
} from "./staff-listing-prices-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./staff-listing-prices-actions", () => ({
  proposeListingPriceAction: vi.fn(),
  decideListingPriceAction: vi.fn(),
}));

const ME = "staff-me";
const OTHER = "staff-other";
const LISTING = "00000000-0000-4000-9000-000000000401";

const row = (over: Partial<ListingPriceRow>): ListingPriceRow => ({
  listingId: LISTING,
  title: "50 SnapApp scans",
  merchantName: "Snap App",
  faceValueMinor: 500 as MinorUnits,
  currency: "AUD",
  lifecycleState: "active",
  redeemPartnerId: "snap-app",
  ledgerPricePoints: 167,
  minPricePoints: 200,
  effectivePricePoints: 200,
  pending: null,
  ...over,
});

const pending = (proposedBy: string, minPricePoints: number | null) => ({
  proposal: {
    id: "prop-1",
    kind: "listing_price" as const,
    region: "AU" as const,
    summary: "Price",
    proposedBy,
    proposedByEmail: "finance.one@example.test",
    approvedBy: null,
    status: "pending" as const,
    reason: "Founder's price",
    createdAt: "2026-11-11T10:00:00.000Z",
    decidedAt: null,
  },
  minPricePoints: minPricePoints as Points | null,
});

function show(rows: ListingPriceRow[], locale: "en-AU" | "id-ID" = "en-AU") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ staff: locale === "en-AU" ? enStaff : idStaff }}
    >
      <StaffListingPricesScreen
        region="AU"
        screen={{ region: "AU", query: null, rows }}
        currentStaffId={ME}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the listing points price screen (2.8.g)", () => {
  it("shows the ledger price, the staff price and what buyers pay", () => {
    show([row({})]);
    expect(screen.getByRole("heading", { name: "50 SnapApp scans" })).toBeInTheDocument();
    expect(screen.getByText("Snap App · $5.00 face value · Redeemed in snap-app")).toBeVisible();
    expect(screen.getByText("Ledger price").nextElementSibling).toHaveTextContent("167 points");
    expect(screen.getByText("Staff price").nextElementSibling).toHaveTextContent("200 points");
    expect(screen.getByText("Buyers pay").nextElementSibling).toHaveTextContent("200 points");
  });

  it("says the ledger price wins when the staff price is below it", () => {
    show([row({ minPricePoints: 150, effectivePricePoints: 167 })]);
    expect(
      screen.getByText(
        "The ledger price (167 points) is above the staff price, so buyers pay the ledger price.",
      ),
    ).toBeInTheDocument();
  });

  it("warns while typing a price below the ledger price", async () => {
    const user = userEvent.setup();
    show([row({ minPricePoints: null, effectivePricePoints: 167 })]);
    const field = screen.getByLabelText("Points price");
    await user.type(field, "150");
    expect(
      screen.getByText(
        "This is below the ledger price of 167 points, so buyers would still pay 167 points.",
      ),
    ).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, "200");
    expect(screen.queryByText(/below the ledger price/)).not.toBeInTheDocument();
  });

  it("proposes a price with its reason, and refreshes", async () => {
    vi.mocked(proposeListingPriceAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    show([row({ minPricePoints: null, effectivePricePoints: 167 })]);
    await user.type(screen.getByLabelText("Points price"), "200");
    await user.type(screen.getByLabelText(/Reason/), "Founder's price");
    await user.click(screen.getByRole("button", { name: "Propose price" }));
    await waitFor(() =>
      expect(proposeListingPriceAction).toHaveBeenCalledWith("AU", LISTING, 200, "Founder's price"),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(
      screen.getByText("The price was proposed and is waiting for a second finance staff member."),
    ).toBeInTheDocument();
  });

  it("proposes removing a staff price only once a reason is given", async () => {
    vi.mocked(proposeListingPriceAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    show([row({})]);
    const clear = screen.getByRole("button", { name: "Propose removing the staff price" });
    expect(clear).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), "Back to the ledger price");
    await user.click(clear);
    await waitFor(() =>
      expect(proposeListingPriceAction).toHaveBeenCalledWith(
        "AU",
        LISTING,
        null,
        "Back to the ledger price",
      ),
    );
  });

  it("lets a second staff member approve or decline, and shows the server's refusal", async () => {
    vi.mocked(decideListingPriceAction).mockResolvedValue({
      ok: false,
      message: "you cannot approve your own proposal",
    });
    const user = userEvent.setup();
    show([row({ pending: pending(OTHER, 250) })]);
    expect(screen.getByText("finance.one@example.test proposed 250 points.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Points price")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve price: 50 SnapApp scans" }));
    await waitFor(() =>
      expect(decideListingPriceAction).toHaveBeenCalledWith("AU", "prop-1", "approve"),
    );
    expect(await screen.findByText("you cannot approve your own proposal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline price: 50 SnapApp scans" })).toBeVisible();
  });

  it("offers the proposer only a withdraw, never an approve", () => {
    show([row({ pending: pending(ME, null) })]);
    expect(
      screen.getByText("finance.one@example.test proposed removing the staff price."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Withdraw proposal: 50 SnapApp scans" }),
    ).toBeVisible();
  });

  it("has an empty state, and reads in Indonesian", () => {
    show([], "id-ID");
    expect(screen.getByText("Belum ada listing dengan harga staf")).toBeInTheDocument();
  });

  it("names the prices in Indonesian", () => {
    show([row({})], "id-ID");
    expect(screen.getByText("Harga ledger").nextElementSibling).toHaveTextContent("167 poin");
    expect(screen.getByText("Dibayar pembeli").nextElementSibling).toHaveTextContent("200 poin");
  });
});
