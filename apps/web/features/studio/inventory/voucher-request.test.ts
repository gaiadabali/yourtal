import { describe, expect, it } from "vitest";
import { buildVoucherRequestBody, requestableStock } from "./voucher-request";

describe("requestableStock", () => {
  it("counts waiting and approved requests against the declared stock, not declined ones", () => {
    expect(
      requestableStock(10, [
        { state: "pending", quantity: 3 },
        { state: "approved", quantity: 2 },
        { state: "rejected", quantity: 4 },
      ]),
    ).toBe(5);
  });

  it("never goes below zero", () => {
    expect(requestableStock(2, [{ state: "approved", quantity: 5 }])).toBe(0);
    expect(requestableStock(7, [])).toBe(7);
  });
});

describe("buildVoucherRequestBody", () => {
  it("builds a stock-only body: a quantity and an optional note, no price", () => {
    expect(buildVoucherRequestBody({ quantity: " 5 ", reason: "  Opening stock. " }, 5)).toEqual({
      ok: true,
      body: { quantity: 5, reason: "Opening stock." },
    });
    expect(buildVoucherRequestBody({ quantity: "2", reason: "" }, 5)).toEqual({
      ok: true,
      body: { quantity: 2, reason: null },
    });
  });

  it("refuses anything that is not a whole number of at least one", () => {
    for (const quantity of ["", "0", "-1", "1.5", "five"]) {
      expect(buildVoucherRequestBody({ quantity, reason: "" }, 5)).toEqual({
        ok: false,
        error: "quantity",
      });
    }
  });

  it("refuses more than the stock left to ask for", () => {
    expect(buildVoucherRequestBody({ quantity: "6", reason: "" }, 5)).toEqual({
      ok: false,
      error: "overStock",
    });
    expect(buildVoucherRequestBody({ quantity: "1", reason: "" }, 0)).toEqual({
      ok: false,
      error: "overStock",
    });
  });
});
