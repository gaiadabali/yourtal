import { describe, expect, it } from "vitest";
import { isValidAbn } from "./abn";
import {
  BUYER_DETAILS_THRESHOLD_MINOR,
  buyerDetailsRequired,
  formatAbn,
  invoiceNumberOf,
  invoiceTitle,
  isTaxInvoiceFor,
} from "./rules";

/** A sample ABN (no ABN Lookup record), 24 872 547 145, passes the checksum. */
describe("isValidAbn", () => {
  it("accepts a well-formed ABN and refuses a wrong digit, a wrong length and non-digits", () => {
    expect(isValidAbn("24872547145")).toBe(true);
    expect(isValidAbn("51824753557")).toBe(false);
    expect(isValidAbn("5182475355")).toBe(false);
    expect(isValidAbn("24 872 547 145")).toBe(false);
    expect(isValidAbn("00000000000")).toBe(false);
  });
});

describe("Tax invoice or Invoice", () => {
  it("is a tax invoice only for a set and valid issuer ABN", () => {
    expect(invoiceTitle(isTaxInvoiceFor("24872547145"))).toBe("Tax invoice");
    expect(invoiceTitle(isTaxInvoiceFor(null))).toBe("Invoice");
    expect(invoiceTitle(isTaxInvoiceFor("12345678901"))).toBe("Invoice");
  });
});

describe("the buyer rule", () => {
  it("applies from A$1,000 including GST", () => {
    expect(BUYER_DETAILS_THRESHOLD_MINOR).toBe(100_000);
    expect(buyerDetailsRequired(99_999)).toBe(false);
    expect(buyerDetailsRequired(100_000)).toBe(true);
  });
});

describe("numbering and display", () => {
  it("pads to six digits and keeps going past a million", () => {
    expect(invoiceNumberOf("AU", 1)).toBe("YT-AU-000001");
    expect(invoiceNumberOf("AU", 999_999)).toBe("YT-AU-999999");
    expect(invoiceNumberOf("AU", 1_234_567)).toBe("YT-AU-1234567");
  });

  it("writes an ABN the way the ATO prints it", () => {
    expect(formatAbn("24872547145")).toBe("24 872 547 145");
  });
});
