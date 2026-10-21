import { describe, expect, it } from "vitest";
import { formatMerchantMoney } from "./merchant-money";

describe("formatMerchantMoney", () => {
  it("keeps the voucher's currency and follows the device's language", () => {
    expect(formatMerchantMoney(4_500, "AUD", "en-AU")).toBe("$45.00");
    expect(formatMerchantMoney(4_500, "AUD", "id-ID")).toBe("AU$45,00");
    expect(formatMerchantMoney(80_000, "IDR", "id-ID")).toMatch(/^Rp\s80\.000$/);
  });
});
