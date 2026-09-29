import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { publicLocaleConfig } from "./public-locale";
import { PublicTransparencyContent } from "./public-transparency-content";

describe("PublicTransparencyContent", () => {
  it("shows an honest empty state when no root has been published yet", () => {
    render(<PublicTransparencyContent roots={[]} locale={publicLocaleConfig("au")} />);
    expect(screen.getByText(/No proof roots have been published yet/)).toBeInTheDocument();
  });

  it("renders each day's own root verbatim, newest first", () => {
    render(
      <PublicTransparencyContent
        roots={[
          {
            date: "2026-09-27",
            merkleRoot: "aaaa1111",
            entryCount: 40,
            computedAt: "2026-09-28T00:00:00.000Z",
          },
          {
            date: "2026-09-28",
            merkleRoot: "bbbb2222",
            entryCount: 55,
            computedAt: "2026-09-29T00:00:00.000Z",
          },
        ]}
        locale={publicLocaleConfig("au")}
      />,
    );

    expect(screen.getAllByText("2026-09-27").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2026-09-28").length).toBeGreaterThan(0);
    expect(screen.getAllByText("aaaa1111").length).toBeGreaterThan(0);
    expect(screen.getAllByText("bbbb2222").length).toBeGreaterThan(0);

    // Newest day first — same order in both the table and the stacked-card view.
    const dateCells = screen.getAllByText(/2026-09-2[78]/);
    expect(dateCells[0]).toHaveTextContent("2026-09-28");
  });
});
