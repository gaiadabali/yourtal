import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PublicJsonLdScript } from "./public-json-ld-script";

describe("PublicJsonLdScript", () => {
  it("renders a script tag carrying the JSON-LD payload", () => {
    const { container } = render(
      <PublicJsonLdScript data={{ "@type": "Organization", name: "Kopi Sentosa" }} />,
    );
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(JSON.parse(script?.innerHTML ?? "{}")).toEqual({
      "@type": "Organization",
      name: "Kopi Sentosa",
    });
  });

  it("escapes an embedded </script> sequence so it cannot close the tag early", () => {
    const { container } = render(
      <PublicJsonLdScript data={{ name: "</script><script>alert(1)</script>" }} />,
    );
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script?.innerHTML ?? "").not.toContain("</script>");
    expect(JSON.parse(script?.innerHTML ?? "{}")).toEqual({
      name: "</script><script>alert(1)</script>",
    });
  });
});
