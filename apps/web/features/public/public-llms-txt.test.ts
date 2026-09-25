import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "./public-llms-txt";

describe("buildLlmsTxt", () => {
  const text = buildLlmsTxt();

  it("follows the llms.txt shape: a title, a summary quote, then sections", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("# YourTal");
    expect(lines[2]).toMatch(/^> YourTal is a video app/);
    expect(text).toContain("## Australia");
    expect(text).toContain("## Indonesia");
  });

  it("links each region's pages in that region's language", () => {
    expect(text).toContain("- [How points work](https://yourtal.com/au/how-points-work): ");
    expect(text).toContain("- [Cara kerja poin](https://yourtal.com/id/how-points-work): ");
    expect(text).toContain("(https://yourtal.com/au/rewards)");
  });
});
