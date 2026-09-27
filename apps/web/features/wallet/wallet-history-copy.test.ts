import { describe, expect, it } from "vitest";
import { describeHistoryEntry } from "./wallet-history-copy";
import { walletTestTranslator } from "./wallet-test-translator";

describe("describeHistoryEntry", () => {
  it("describes every kind in plain language from the amount alone, in en-AU", () => {
    const t = walletTestTranslator("en-AU");
    expect(describeHistoryEntry("earn", "2,400 points", t)).toBe("Earned 2,400 points");
    expect(describeHistoryEntry("burn", "500 points", t)).toBe("Redeemed 500 points for a voucher");
    expect(describeHistoryEntry("expiry", "100 points", t)).toBe("100 points expired");
    expect(describeHistoryEntry("reversal", "500 points", t)).toBe(
      "500 points returned to your wallet",
    );
    expect(describeHistoryEntry("adjustment", "50 points", t)).toBe(
      "Balance adjusted by 50 points",
    );
  });

  it("never contains a bare transaction code, merchant name, or ledger reference", () => {
    const t = walletTestTranslator("id-ID");
    const description = describeHistoryEntry("earn", "2.400 poin", t);
    expect(description).not.toMatch(/TXN_|CAMPAIGN_\d/);
  });

  it("describes every kind in id-ID", () => {
    const t = walletTestTranslator("id-ID");
    expect(describeHistoryEntry("earn", "2.400 poin", t)).toBe("Mendapat 2.400 poin");
    expect(describeHistoryEntry("burn", "500 poin", t)).toBe("Ditukar 500 poin untuk voucher");
  });
});
