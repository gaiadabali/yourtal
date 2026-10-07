import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Listing, SettlementDecreaseRequest } from "@yourtal/contracts/listing";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import { toMinorUnits } from "@yourtal/contracts/money";
import { StudioIntlProvider } from "../studio-test-i18n";
import { InventoryScreen } from "./inventory-screen";
import type { InventoryScreenProps } from "./inventory-screen";

// The server actions import server-only modules; the screen is checked without them.
vi.mock("./inventory-actions", () => ({
  createLocationAction: vi.fn(),
  createListingAction: vi.fn(),
  changeSettlementValueAction: vi.fn(),
  approveSettlementDecreaseAction: vi.fn(),
  updateListingTags: vi.fn(),
}));

const BUSINESS_ID = "00000000-0000-4000-8000-000000000a01";
const LISTING_ID = "00000000-0000-4000-8000-000000000b01";
const LOCATION: MerchantLocation = {
  id: "00000000-0000-4000-8000-000000000c01",
  name: "Laneway",
  address: "12 Degraves St",
  district: "Melbourne",
};
const MERCHANDISER = "00000000-0000-4000-8000-000000000d01";
const OWNER = "00000000-0000-4000-8000-000000000d02";
const ADMIN = "00000000-0000-4000-8000-000000000d03";

const LISTING = {
  id: LISTING_ID,
  merchantId: BUSINESS_ID,
  merchantName: "Cafe",
  title: "Flat white",
  description: "One flat white.",
  category: "food_beverage",
  locations: [LOCATION],
  currency: "AUD",
  faceValueMinor: 1000,
  settlementValueMinor: 700,
  priceInPoints: 1234,
  stockRemaining: 3,
  stockTotal: 5,
  transferable: false,
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendMinor: null,
  expiresAt: "2027-01-01T00:00:00.000Z",
  status: "sold_out",
  region: "AU",
  audience: "all_ages",
  contentCategory: "food-and-drink",
  tags: [],
  imageUrl: "https://images.example/a.jpg",
  channel: "in_store",
  partialRedemption: "single_use",
} as unknown as Listing;

const REQUEST: SettlementDecreaseRequest = {
  id: "00000000-0000-4000-8000-000000000e01",
  listingId: LISTING_ID,
  currency: "AUD",
  currentSettlementValueMinor: toMinorUnits(700),
  proposedSettlementValueMinor: toMinorUnits(600),
  requestedBy: MERCHANDISER,
  reason: "Winter promotion.",
  state: "pending",
  approvedBy: null,
  approvedAt: null,
  createdAt: "2026-10-07T00:00:00.000Z",
};

function renderScreen(overrides: Partial<InventoryScreenProps> = {}) {
  const props: InventoryScreenProps = {
    businessId: BUSINESS_ID,
    merchantName: "Cafe",
    region: "AU",
    currency: "AUD",
    listings: [LISTING],
    locations: [LOCATION],
    pendingDecreaseRequests: [REQUEST],
    canEdit: true,
    canApprove: true,
    currentUserId: OWNER,
    locale: "en-AU",
    ...overrides,
  };
  const ui: ReactElement = (
    <StudioIntlProvider>
      <InventoryScreen {...props} />
    </StudioIntlProvider>
  );
  return render(ui);
}

describe("InventoryScreen", () => {
  it("shows the computed price and a localised status, not the raw enum", () => {
    renderScreen();
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    expect(screen.queryByText("sold_out")).not.toBeInTheDocument();
    expect(screen.queryByText("sold out")).not.toBeInTheDocument();
    expect(screen.getByLabelText("1,234 points")).toBeInTheDocument();
  });

  it("gives the second approver a button for someone else's request", () => {
    renderScreen({ currentUserId: OWNER });
    expect(
      screen.getByRole("button", { name: "Approve the reduction for Flat white" }),
    ).toBeInTheDocument();
  });

  it("gives the requester no button, and says why", () => {
    renderScreen({
      currentUserId: ADMIN,
      pendingDecreaseRequests: [{ ...REQUEST, requestedBy: ADMIN }],
    });
    expect(screen.queryByRole("button", { name: /Approve the reduction/ })).toBeNull();
    expect(screen.getByText(/You requested this reduction/)).toBeInTheDocument();
  });

  it("shows a merchandiser the queue without an approve button", () => {
    renderScreen({ canApprove: false, currentUserId: MERCHANDISER });
    expect(screen.queryByRole("button", { name: /Approve the reduction/ })).toBeNull();
    expect(screen.getByText("An owner or admin approves this reduction.")).toBeInTheDocument();
  });

  it("offers the write buttons only to roles that can edit", () => {
    const { unmount } = renderScreen();
    expect(screen.getByRole("button", { name: "New listing" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add location" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change the settlement value of Flat white" }),
    ).toBeInTheDocument();
    unmount();
    renderScreen({ canEdit: false });
    expect(screen.queryByRole("button", { name: "New listing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add location" })).toBeNull();
  });

  it("will not start a listing before a location exists", () => {
    renderScreen({ locations: [] });
    expect(screen.getByRole("button", { name: "New listing" })).toBeDisabled();
    expect(screen.getByText("Add a location before you create a listing.")).toBeInTheDocument();
  });
});
