import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { Region } from "@yourtal/contracts/region";
import { assertSettingValue } from "./setting-validation";
import type { ReceiptFunderFacts } from "./setting-validation";

const BUSINESS = "00000000-0000-4000-9000-000000000001";
const ledger = {
  checkPackageTiers: () => {
    throw new Error("not used");
  },
};

function funders(
  business: { region: Region; isVerified: boolean } | null,
  partners: readonly string[] = ["snap-app"],
): ReceiptFunderFacts {
  return {
    partnerExists: (id) => Promise.resolve(partners.includes(id)),
    businessFacts: (id) => Promise.resolve(id === BUSINESS ? business : null),
  };
}
const ok = { region: "AU", isVerified: true } as const;

const run = (key: string, value: unknown, f: ReceiptFunderFacts, region: Region = "AU") =>
  assertSettingValue(ledger, region, key, value, f);

async function refusal(promise: Promise<void>): Promise<string> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  const response = (error as BadRequestException).getResponse() as {
    code: string;
    message: string;
  };
  expect(response.code).toBe("invalid_setting");
  return response.message;
}

describe("receipt_funder.<partnerId>", () => {
  it("accepts a verified business in the setting's region", async () => {
    await expect(
      run("receipt_funder.snap-app", { businessId: BUSINESS }, funders(ok)),
    ).resolves.toBeUndefined();
  });

  it("refuses an unknown partner", async () => {
    const message = await refusal(
      run("receipt_funder.nobody", { businessId: BUSINESS }, funders(ok)),
    );
    expect(message).toContain("receipt_funder.nobody");
    expect(message).toContain("does not exist");
  });

  it.each([
    ["an upper-case hex uuid", { businessId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }],
    ["not a uuid", { businessId: "snap" }],
    ["an extra key", { businessId: BUSINESS, extra: 1 }],
    ["no businessId", {}],
    ["a string", BUSINESS],
    ["undefined", undefined],
  ])("refuses a value that is %s", async (_label, value) => {
    await refusal(run("receipt_funder.snap-app", value, funders(ok)));
  });

  it("refuses a business that does not exist, is unverified, or is in another region", async () => {
    expect(
      await refusal(run("receipt_funder.snap-app", { businessId: BUSINESS }, funders(null))),
    ).toContain("existing business");
    expect(
      await refusal(
        run(
          "receipt_funder.snap-app",
          { businessId: BUSINESS },
          funders({ region: "AU", isVerified: false }),
        ),
      ),
    ).toContain("not verified");
    expect(
      await refusal(
        run(
          "receipt_funder.snap-app",
          { businessId: BUSINESS },
          funders({ region: "ID", isVerified: true }),
        ),
      ),
    ).toContain("not in region AU");
  });

  it("checks the business against the setting's region, not a fixed one", async () => {
    await expect(
      run(
        "receipt_funder.snap-app",
        { businessId: BUSINESS },
        funders({ region: "ID", isVerified: true }),
        "ID",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("receipt_points", () => {
  it.each([1, 10, 100, 1000, 8, 125])("accepts %s", async (value) => {
    await expect(run("receipt_points", value, funders(null))).resolves.toBeUndefined();
  });

  it.each([3, 0, -1, 1.5, 7, 2000, "10", null, undefined])("refuses %s", async (value) => {
    expect(await refusal(run("receipt_points", value, funders(null)))).toContain("divides 1000");
  });
});

it("leaves other keys alone", async () => {
  await expect(run("anything_else", "x", funders(null))).resolves.toBeUndefined();
});
