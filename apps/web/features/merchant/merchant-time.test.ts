import { describe, expect, it } from "vitest";
import { formatMerchantTime } from "./merchant-time";

// 14:30 UTC on 21 Oct is already 01:30 on the 22nd in Sydney (AEDT, +11) but 21:30 on the 21st in Jakarta (+7).
const NEAR_MIDNIGHT_UTC = "2026-10-21T14:30:00.000Z";

describe("formatMerchantTime", () => {
  it("shows an Australian counter its own clock, whatever zone the process runs in", () => {
    expect(formatMerchantTime(NEAR_MIDNIGHT_UTC, "en-AU", "AU")).toMatch(/^1:30\s?am$/iu);
  });

  it("shows an Indonesian counter Jakarta time", () => {
    expect(formatMerchantTime(NEAR_MIDNIGHT_UTC, "id-ID", "ID")).toMatch(/^21[.:]30$/u);
  });

  it("names the right day, not the UTC one", () => {
    expect(formatMerchantTime(NEAR_MIDNIGHT_UTC, "en-AU", "AU", "dateTime")).toContain(
      "22 October",
    );
    expect(formatMerchantTime(NEAR_MIDNIGHT_UTC, "id-ID", "ID", "dateTime")).toContain(
      "21 Oktober",
    );
  });

  it("gives the same answer under any process zone", () => {
    const original = process.env["TZ"];
    try {
      const answers = ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"].map((zone) => {
        process.env["TZ"] = zone;
        return formatMerchantTime(NEAR_MIDNIGHT_UTC, "en-AU", "AU", "dateTime");
      });
      expect(new Set(answers).size).toBe(1);
    } finally {
      if (original === undefined) delete process.env["TZ"];
      else process.env["TZ"] = original;
    }
  });
});
