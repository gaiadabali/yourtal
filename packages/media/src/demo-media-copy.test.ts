import { describe, expect, it } from "vitest";
import { demoCampaignCopy } from "./demo-media";

describe("demoCampaignCopy", () => {
  it("speaks the campaign's region's language and never cites tickets or tooling", () => {
    const au = demoCampaignCopy("Bondi Board Co.", "AU");
    const id = demoCampaignCopy("Bali Batik House", "ID");
    expect(au.title).toBe("Get to know Bondi Board Co.");
    expect(id.title).toBe("Kenalan dengan Bali Batik House");
    for (const text of [au.title, au.synopsis, id.title, id.synopsis]) {
      expect(text).not.toMatch(/\(\d+\.\d+|pnpm|\(F\d+\)|demo/i);
    }
  });
});
