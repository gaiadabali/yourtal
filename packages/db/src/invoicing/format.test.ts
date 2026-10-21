import { describe, expect, it } from "vitest";
import { pointsLine, receiptPointsLine } from "./format";

describe("invoice wording", () => {
  it("names a receipt package's points for receipt rewards, in en-AU and id-ID", () => {
    expect(receiptPointsLine(1_000)).toBe("1,000 YourTal points for receipt rewards");
    expect(receiptPointsLine(50_000, "AU")).toBe("50,000 YourTal points for receipt rewards");
    expect(receiptPointsLine(1_000, "ID")).toBe("1.000 poin YourTal untuk hadiah struk");
  });

  it("leaves an ordinary package's line alone", () => {
    expect(pointsLine(1_000)).toBe("1,000 YourTal points");
  });
});
