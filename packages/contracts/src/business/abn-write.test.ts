import { describe, expect, it } from "vitest";
import { ABN_CHECK_MESSAGE, abnWriteIssue, businessSchema } from "./business";
import { auBusinessFixture } from "./business.mock";

describe("abnWriteIssue (6.10.b)", () => {
  it("passes the ATO's own example ABN, with or without spaces", () => {
    expect(abnWriteIssue("ABN", "51824753556")).toBeNull();
    expect(abnWriteIssue("ABN", "51 824 753 556")).toBeNull();
  });

  it("refuses a one-digit change, a wrong length and all zeros, with the en-AU message", () => {
    for (const abn of ["51824753557", "41824753556", "5182475355", "00000000000"]) {
      expect(abnWriteIssue("ABN", abn), abn).toBe(ABN_CHECK_MESSAGE);
    }
    expect(ABN_CHECK_MESSAGE).toBe(
      "That ABN doesn't look right. Check the 11 digits on your ABN record.",
    );
  });

  it("has no opinion on NIB or NPWP", () => {
    expect(abnWriteIssue("NPWP", "1234567890123456")).toBeNull();
    expect(abnWriteIssue("NIB", "9120001234567")).toBeNull();
  });
});

describe("reads stay lenient (6.10.b)", () => {
  it("still parses a stored business whose ABN fails the check digit (old demo data)", () => {
    const stored = { ...auBusinessFixture, taxIdValue: "00000000000" };
    expect(businessSchema.safeParse(stored).success).toBe(true);
  });
});
