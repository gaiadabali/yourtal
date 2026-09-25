import { describe, expect, it } from "vitest";
import { categoryPolicy, contentCategorySchema } from "./content-category";

describe("categoryPolicy", () => {
  it("prohibits tobacco and vaping in both regions", () => {
    expect(categoryPolicy("AU", "tobacco")).toBe("prohibited");
    expect(categoryPolicy("AU", "vaping")).toBe("prohibited");
    expect(categoryPolicy("ID", "tobacco")).toBe("prohibited");
    expect(categoryPolicy("ID", "vaping")).toBe("prohibited");
  });

  it("prohibits gambling in ID but only restricts it to adults in AU", () => {
    expect(categoryPolicy("ID", "gambling")).toBe("prohibited");
    expect(categoryPolicy("AU", "gambling")).toBe("adult_only");
  });

  it("restricts alcohol, dating, financial products, weight loss, cosmetic procedures and energy drinks to adults in both regions", () => {
    const adultOnlyEverywhere = [
      "alcohol",
      "dating",
      "financial-products",
      "weight-loss",
      "cosmetic-procedures",
      "energy-drinks",
    ] as const;
    for (const category of adultOnlyEverywhere) {
      expect(categoryPolicy("AU", category)).toBe("adult_only");
      expect(categoryPolicy("ID", category)).toBe("adult_only");
    }
  });

  it("allows every ordinary catalogue category in both regions", () => {
    const ordinary = [
      "food-and-drink",
      "fashion",
      "personal-care",
      "electronics",
      "telco",
      "transport",
      "fitness",
      "education",
      "travel",
      "home",
      "entertainment",
      "games",
      "books",
      "family",
      "toys",
      "digital-goods",
      "services",
    ] as const;
    for (const category of ordinary) {
      expect(categoryPolicy("AU", category)).toBe("allowed");
      expect(categoryPolicy("ID", category)).toBe("allowed");
    }
  });
});

describe("contentCategorySchema", () => {
  it("rejects an unknown category", () => {
    expect(contentCategorySchema.safeParse("crypto").success).toBe(false);
  });
});
