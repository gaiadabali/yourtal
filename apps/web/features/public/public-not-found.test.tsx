import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublicNotFound } from "./public-not-found";

describe("PublicNotFound", () => {
  it("leads in English and offers the way back to both regions", () => {
    render(<PublicNotFound />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "We couldn't find that page",
    );
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
      "href",
      "/au",
    );
    expect(screen.getByRole("link", { name: "Ke beranda" })).toHaveAttribute("href", "/id");
  });
});
