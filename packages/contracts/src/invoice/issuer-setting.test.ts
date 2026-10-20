import { describe, expect, it } from "vitest";
import { invoiceIssuerSettingSchema } from "./issuer-setting";

const GOOD = {
  legalName: "YourTal Pty Ltd",
  abn: "51824753556",
  address: "1 Example St, Sydney NSW 2000",
  email: "billing@yourtal.example",
};

const issues = (value: unknown) => {
  const parsed = invoiceIssuerSettingSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
};

describe("invoice_issuer setting", () => {
  it("accepts a full company with an ABN, with spaces in it, or with none", () => {
    expect(invoiceIssuerSettingSchema.safeParse(GOOD).success).toBe(true);
    expect(invoiceIssuerSettingSchema.safeParse({ ...GOOD, abn: "51 824 753 556" }).success).toBe(
      true,
    );
    expect(invoiceIssuerSettingSchema.safeParse({ ...GOOD, abn: null }).success).toBe(true);
  });

  it("refuses each missing or malformed field by name", () => {
    expect(issues({ ...GOOD, legalName: "  " })).toStrictEqual(["legalName"]);
    expect(issues({ ...GOOD, address: "" })).toStrictEqual(["address"]);
    expect(issues({ ...GOOD, email: "not-an-email" })).toStrictEqual(["email"]);
    expect(issues({ ...GOOD, email: "a@b" })).toStrictEqual(["email"]);
    // A wrong checksum digit, a short number, letters, an empty string, and no abn key at all.
    expect(issues({ ...GOOD, abn: "51824753557" })).toStrictEqual(["abn"]);
    expect(issues({ ...GOOD, abn: "5182475355" })).toStrictEqual(["abn"]);
    expect(issues({ ...GOOD, abn: "5182475355A" })).toStrictEqual(["abn"]);
    expect(issues({ ...GOOD, abn: "" })).toStrictEqual(["abn"]);
    expect(
      issues({ legalName: GOOD.legalName, address: GOOD.address, email: GOOD.email }),
    ).toStrictEqual(["abn"]);
  });

  it("refuses a value that is not an object, and keys it does not know", () => {
    expect(invoiceIssuerSettingSchema.safeParse("YourTal").success).toBe(false);
    expect(invoiceIssuerSettingSchema.safeParse(null).success).toBe(false);
    expect(invoiceIssuerSettingSchema.safeParse({ ...GOOD, phone: "1" }).success).toBe(false);
  });
});
