import { describe, expect, it } from "vitest";
import { rateAgainstBudget } from "./rum-budgets";

describe("rateAgainstBudget", () => {
  it("rates LCP at the docs/08 budget boundary, not Lighthouse's own thresholds", () => {
    expect(rateAgainstBudget("LCP", 2000)).toBe("good");
    expect(rateAgainstBudget("LCP", 2100)).toBe("needs-improvement");
    expect(rateAgainstBudget("LCP", 2500)).toBe("poor");
  });

  it("rates INP at the 200ms field budget", () => {
    expect(rateAgainstBudget("INP", 199)).toBe("good");
    expect(rateAgainstBudget("INP", 200)).toBe("good");
    expect(rateAgainstBudget("INP", 201)).toBe("poor");
  });

  it("rates CLS at the 0.1 budget", () => {
    expect(rateAgainstBudget("CLS", 0.09)).toBe("good");
    expect(rateAgainstBudget("CLS", 0.15)).toBe("poor");
  });
});
