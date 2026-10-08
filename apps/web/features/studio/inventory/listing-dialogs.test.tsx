import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudioIntlProvider } from "../studio-test-i18n";
import { EditListingDialog } from "./edit-listing-dialog";
import {
  createListingImageUploadUrlAction,
  editListingAction,
  requestVoucherBatchAction,
} from "./inventory-actions";
import { ListingImageField } from "./listing-image-field";
import { VoucherRequestDialog } from "./voucher-request-dialog";

vi.mock("./inventory-actions", () => ({
  requestVoucherBatchAction: vi.fn(),
  editListingAction: vi.fn(),
  createListingImageUploadUrlAction: vi.fn(),
}));

const BUSINESS_ID = "00000000-0000-4000-8000-000000000a01";
const LISTING_ID = "00000000-0000-4000-8000-000000000b01";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("VoucherRequestDialog", () => {
  function open(requestable = 5) {
    render(
      <StudioIntlProvider>
        <VoucherRequestDialog
          businessId={BUSINESS_ID}
          listingId={LISTING_ID}
          listingTitle="Flat white"
          stockTotal={5}
          requestable={requestable}
        />
      </StudioIntlProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Request vouchers for Flat white" }));
  }

  it("sends a stock-only request and then says it is waiting for review", async () => {
    vi.mocked(requestVoucherBatchAction).mockResolvedValue({ ok: true, value: { quantity: 5 } });
    open();
    fireEvent.change(screen.getByLabelText("How many vouchers"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Note for the reviewer (optional)"), {
      target: { value: "Opening stock." },
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    });
    expect(requestVoucherBatchAction).toHaveBeenCalledWith(BUSINESS_ID, LISTING_ID, {
      quantity: 5,
      reason: "Opening stock.",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Request for 5 vouchers sent. It is waiting for a YourTal reviewer.",
    );
  });

  it("refuses a quantity above the stock left to ask for, without calling the server", () => {
    open(2);
    fireEvent.change(screen.getByLabelText("How many vouchers"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByText(/more than the stock left to ask for \(2\)/)).toBeInTheDocument();
    expect(requestVoucherBatchAction).not.toHaveBeenCalled();
  });

  it("words a refusal from the server instead of showing its code", async () => {
    vi.mocked(requestVoucherBatchAction).mockResolvedValue({ ok: false, code: "forbidden" });
    open();
    fireEvent.change(screen.getByLabelText("How many vouchers"), { target: { value: "1" } });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Your role cannot do that.");
  });

  it("says when everything in stock has already been asked for", () => {
    open(0);
    expect(screen.getByText("You have already asked for all 5 in stock.")).toBeInTheDocument();
  });
});

describe("EditListingDialog", () => {
  const original = {
    title: "Flat white",
    stockTotal: 5,
    expiresAt: new Date("2027-01-15T23:59:59").toISOString(),
  };

  function open() {
    render(
      <StudioIntlProvider>
        <EditListingDialog businessId={BUSINESS_ID} listingId={LISTING_ID} original={original} />
      </StudioIntlProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Flat white" }));
  }

  it("has no price or settlement field", () => {
    open();
    expect(screen.getByLabelText("Title")).toHaveValue("Flat white");
    expect(screen.getByLabelText("Stock")).toHaveValue("5");
    expect(screen.queryByLabelText(/price|settlement/i)).toBeNull();
  });

  it("saves only the field that changed", async () => {
    vi.mocked(editListingAction).mockResolvedValue({ ok: true, value: { title: "Flat white" } });
    open();
    fireEvent.change(screen.getByLabelText("Stock"), { target: { value: "9" } });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(editListingAction).toHaveBeenCalledWith(BUSINESS_ID, LISTING_ID, { stockTotal: 9 });
    expect(await screen.findByRole("status")).toHaveTextContent("Listing updated.");
  });

  it("tells the person when nothing has changed, and does not call the server", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Change something to save.");
    expect(editListingAction).not.toHaveBeenCalled();
  });

  it("explains an invalid stock in place", () => {
    open();
    fireEvent.change(screen.getByLabelText("Stock"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Enter a whole number of at least 1.")).toBeInTheDocument();
    expect(editListingAction).not.toHaveBeenCalled();
  });

  it("words a refusal from the server", async () => {
    vi.mocked(editListingAction).mockResolvedValue({ ok: false, code: "listing_not_found" });
    open();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Flat white XL" } });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("That listing no longer exists.");
  });
});

describe("ListingImageField", () => {
  function field(onChange = vi.fn()) {
    render(
      <StudioIntlProvider>
        <ListingImageField
          businessId={BUSINESS_ID}
          imageUrl=""
          onChange={onChange}
          disabled={false}
        />
      </StudioIntlProvider>,
    );
    return onChange;
  }
  const picker = () => screen.getByLabelText("Picture");

  it("refuses a file that is not a web picture before asking to upload", async () => {
    field();
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(picker(), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Use a JPEG, PNG or WebP picture.");
    expect(createListingImageUploadUrlAction).not.toHaveBeenCalled();
  });

  it("refuses a picture over the size limit", async () => {
    field();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(picker(), { target: { files: [big] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("over 5 MB");
    expect(createListingImageUploadUrlAction).not.toHaveBeenCalled();
  });

  it("uploads straight to the presigned address and hands the form the public one", async () => {
    vi.mocked(createListingImageUploadUrlAction).mockResolvedValue({
      ok: true,
      value: {
        uploadUrl: "https://upload.example/put",
        imageUrl: "https://site.example/media/posters/listings/x.png",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const onChange = field();
    const file = new File(["png bytes"], "cup.png", { type: "image/png" });
    fireEvent.change(picker(), { target: { files: [file] } });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("https://site.example/media/posters/listings/x.png"),
    );
    expect(createListingImageUploadUrlAction).toHaveBeenCalledWith(BUSINESS_ID, "image/png");
    expect(fetchMock).toHaveBeenCalledWith("https://upload.example/put", {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: file,
    });
    vi.unstubAllGlobals();
  });

  it("says so when the upload fails, and gives the form nothing", async () => {
    vi.mocked(createListingImageUploadUrlAction).mockResolvedValue({
      ok: true,
      value: { uploadUrl: "https://upload.example/put", imageUrl: "https://site.example/x.png" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const onChange = field();
    fireEvent.change(picker(), {
      target: { files: [new File(["x"], "cup.png", { type: "image/png" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The picture could not be uploaded. Try again.",
    );
    expect(onChange).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
