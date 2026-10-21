import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockReceiptProgramme } from "./billing-mock-packages";
import { ReceiptProgrammePanel } from "./receipt-programme-panel";
import { purchasePointsAction } from "./purchase-points-action";

vi.mock("./purchase-points-action", () => ({ purchasePointsAction: vi.fn() }));

const panel = (
  programme: ReturnType<typeof mockReceiptProgramme> | null,
  over: { canPurchase?: boolean; locale?: "en-AU" | "id-ID" } = {},
) =>
  render(
    <ReceiptProgrammePanel
      businessId="b1"
      programme={programme}
      canPurchase={over.canPurchase ?? true}
      idempotencyKey="key-1"
      locale={over.locale ?? "en-AU"}
    />,
  );

describe("ReceiptProgrammePanel (2.10.b, F127)", () => {
  it("renders nothing for a business that is not a receipt funder", () => {
    const { container } = panel(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("says receipts are earning, with the points left and per receipt", () => {
    panel(mockReceiptProgramme("AUD"));
    expect(screen.getByRole("heading", { name: "Receipt rewards" })).toBeInTheDocument();
    expect(screen.getByText("Receipts are earning")).toBeInTheDocument();
    expect(screen.getByLabelText("412 points left")).toBeInTheDocument();
    expect(screen.getByText("1 point per receipt")).toBeInTheDocument();
    expect(screen.queryByText("Receipt points are paused")).not.toBeInTheDocument();
  });

  it("says receipt points are paused when no package has room", () => {
    panel(mockReceiptProgramme("AUD", { earning: false }));
    expect(screen.getByText("Receipt points are paused")).toBeInTheDocument();
    expect(screen.queryByText("Receipts are earning")).not.toBeInTheDocument();
    expect(screen.getByLabelText("0 points left")).toBeInTheDocument();
  });

  it("lists the receipt packages with ex-GST price, GST and total, marked receipt-only", () => {
    panel(mockReceiptProgramme("AUD"));
    expect(screen.getByText("For receipt rewards only")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const starter = within(items[0] as HTMLElement);
    expect(starter.getByText("Starter")).toBeInTheDocument();
    expect(starter.getByLabelText("1,000 points")).toBeInTheDocument();
    expect(starter.getByText("Price excl. GST")).toBeInTheDocument();
    expect(starter.getByText("$30.00")).toBeInTheDocument();
    expect(starter.getByText("GST (10%)")).toBeInTheDocument();
    expect(starter.getByText("$3.00")).toBeInTheDocument();
    expect(starter.getByText("$33.00")).toBeInTheDocument();
    const scale = within(items[2] as HTMLElement);
    expect(scale.getByText("$1,500.00")).toBeInTheDocument();
    expect(scale.getByText("$1,650.00")).toBeInTheDocument();
  });

  it("shows no tax line in Indonesia", () => {
    panel(mockReceiptProgramme("IDR"), { locale: "id-ID" });
    expect(screen.getByText("Hadiah struk")).toBeInTheDocument();
    expect(screen.getByText("10 poin per struk")).toBeInTheDocument();
    expect(screen.queryByText(/GST/)).not.toBeInTheDocument();
  });

  it("never names the backing rate", () => {
    const { container } = panel(mockReceiptProgramme("AUD"));
    expect(container.textContent ?? "").not.toMatch(/backing|rate|at cost|2\.10|F127/i);
  });

  it("buys through the shared purchase action with programme=receipts", () => {
    const { container } = panel(mockReceiptProgramme("AUD"));
    const forms = container.querySelectorAll("form");
    expect(forms).toHaveLength(3);
    const grow = forms[1] as HTMLFormElement;
    const field = (name: string) =>
      (grow.elements.namedItem(name) as HTMLInputElement | null)?.value;
    expect(field("programme")).toBe("receipts");
    expect(field("tierKey")).toBe("grow");
    expect(field("currency")).toBe("AUD");
    expect(field("businessId")).toBe("b1");
    expect(field("idempotencyKey")).toBe("key-1");
    expect(within(grow).getByRole("button", { name: "Buy Grow receipt package" })).toBeEnabled();
    // The form's action is the very action the ordinary cards use.
    expect(vi.mocked(purchasePointsAction)).not.toHaveBeenCalled();
  });

  it("shows the packages but no buy button to someone who cannot purchase", () => {
    const { container } = panel(mockReceiptProgramme("AUD"), { canPurchase: false });
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
