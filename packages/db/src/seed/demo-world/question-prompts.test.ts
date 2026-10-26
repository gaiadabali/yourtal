import { describe, expect, it } from "vitest";
import { DEMO_FACTS } from "./catalogue";
import { demoQuestionPrompt } from "./question-prompts";

describe("the demo question prompts (V25)", () => {
  it("asks a different question for each on-screen fact, naming the business", () => {
    for (const region of ["AU", "ID"] as const) {
      const prompts = DEMO_FACTS[region].map((_, index) =>
        demoQuestionPrompt(region, index, "Little Sprouts"),
      );
      expect(new Set(prompts).size).toBe(DEMO_FACTS[region].length);
      for (const prompt of prompts) {
        expect(prompt).toContain("Little Sprouts");
        expect(prompt.length).toBeLessThanOrEqual(300);
      }
    }
  });

  it("is written in the campaign's own language", () => {
    expect(demoQuestionPrompt("AU", 0, "Little Sprouts")).toMatch(/^In the /);
    expect(demoQuestionPrompt("ID", 0, "Tunas Ceria")).toMatch(/^Di video /);
  });
});
