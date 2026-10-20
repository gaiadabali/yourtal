import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PointPackage } from "@yourtal/contracts/billing";
import { BillingPackagePicker } from "./billing-package-picker";
import { mockPackages } from "./billing-mock-packages";
import { purchasePointsAction } from "./purchase-points-action";

vi.mock("./purchase-points-action", () => ({ purchasePointsAction: vi.fn() }));

const au = mockPackages("AUD");
const id = mockPackages("IDR");

const picker = (
  packages: readonly PointPackage[],
  over: { canPurchase?: boolean; locale?: "en-AU" | "id-ID" } = {},
) =>
  render(
    <BillingPackagePicker
      businessId="b1"
      packages={packages}
      canPurchase={over.canPurchase ?? true}
      idempotencyKey="key-1"
      locale={over.locale ?? "en-AU"}
    />,
  );

/** The card a radio belongs to, so assertions stay inside one package. */
const card = (name: string) => {
  const element = screen.getByRole("radio", { name }).closest("div.relative");
  if (!(element instanceof HTMLElement)) throw new Error(`no card for ${name}`);
  return within(element);
};

beforeEach(() => vi.mocked(purchasePointsAction).mockReset());

describe("BillingPackagePicker, Australia (F118/F122)", () => {
  it("shows each package with its price per 1,000, GST and total", () => {
    picker(au);
    const grow = card("Grow");
    expect(grow.getByLabelText("10,000 points")).toBeInTheDocument();
    expect(grow.getByText("$42.75 per 1,000 points, ex-GST")).toBeInTheDocument();
    expect(grow.getByText("Saves $22.50 ex-GST")).toBeInTheDocument();
    expect(grow.getByText("Price excl. GST")).toBeInTheDocument();
    expect(grow.getByText("$427.50")).toBeInTheDocument();
    expect(grow.getByText("GST (10%)")).toBeInTheDocument();
    expect(grow.getByText("$42.75")).toBeInTheDocument();
    expect(grow.getByText("$470.25")).toBeInTheDocument();

    const scale = card("Scale");
    expect(scale.getByText("$40.50 per 1,000 points, ex-GST")).toBeInTheDocument();
    expect(scale.getByText("Saves $225.00 ex-GST")).toBeInTheDocument();
    expect(scale.getByText("$2,227.50")).toBeInTheDocument();
  });

  it("shows no saving on the Starter package", () => {
    picker(au);
    const starter = card("Starter");
    expect(starter.queryByText(/Saves/)).not.toBeInTheDocument();
    expect(starter.getByText("$49.50")).toBeInTheDocument();
  });

  it("offers one Buy and the first package is chosen to begin with", () => {
    picker(au);
    expect(screen.getAllByRole("button", { name: "Buy" })).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Starter" })).toBeChecked();
  });

  it("posts the chosen package's tier key and the currency", async () => {
    picker(au);
    await userEvent.click(screen.getByRole("radio", { name: "Grow" }));
    await userEvent.click(screen.getByRole("button", { name: "Buy" }));
    const formData = vi.mocked(purchasePointsAction).mock.calls[0]?.[0];
    expect(formData?.get("tierKey")).toBe("grow");
    expect(formData?.get("currency")).toBe("AUD");
    expect(formData?.get("businessId")).toBe("b1");
    expect(formData?.get("idempotencyKey")).toBe("key-1");
    expect(formData?.has("points")).toBe(false);
  });

  it("names a tier the catalogue adds later with a generic label", () => {
    const grow = au[1];
    if (!grow) throw new Error("fixture has no Grow package");
    picker([...au, { ...grow, tierKey: "enterprise" }]);
    expect(screen.getByRole("radio", { name: "Package" })).toBeInTheDocument();
  });

  it("lists the packages without a form for someone who cannot buy", () => {
    picker(au, { canPurchase: false });
    expect(screen.queryByRole("button", { name: "Buy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("Grow")).toBeInTheDocument();
    expect(screen.getByText("$470.25")).toBeInTheDocument();
  });
});

describe("BillingPackagePicker, Indonesia", () => {
  it("shows no GST line and no ex-GST wording", () => {
    picker(id, { locale: "id-ID" });
    const grow = card("Tumbuh");
    expect(grow.queryByText(/Pajak/)).not.toBeInTheDocument();
    expect(grow.queryByText("Harga sebelum pajak")).not.toBeInTheDocument();
    expect(grow.queryByText(/belum termasuk pajak/)).not.toBeInTheDocument();
    expect(grow.getByText(/8\.550 per 1\.000 poin/)).toBeInTheDocument();
    expect(grow.getByText(/Hemat/)).toHaveTextContent("4.500");
    expect(grow.getByText("Total")).toBeInTheDocument();
  });
});
