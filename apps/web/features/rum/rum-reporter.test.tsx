import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RegionProvider } from "@/features/region/region-context";
import { RumReporter } from "./rum-reporter";

describe("RumReporter", () => {
  it("mounts and registers web-vitals listeners without throwing, even where PerformanceObserver is unavailable (jsdom, and real Safari/Firefox for some entry types) — web-vitals itself feature-detects and swallows that, per its own observe() doc comment", () => {
    expect(() =>
      render(
        <RegionProvider region="ID">
          <RumReporter />
        </RegionProvider>,
      ),
    ).not.toThrow();
  });

  it("renders no visible output — it exists purely for its effect", () => {
    const { container } = render(
      <RegionProvider region="ID">
        <RumReporter />
      </RegionProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
