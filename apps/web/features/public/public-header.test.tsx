import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublicHeader } from "./public-header";

describe("PublicHeader", () => {
  it("links the wordmark home and offers a sign-up call to action to onboarding", () => {
    render(<PublicHeader locale="id-ID" homeHref="/id" />);
    expect(screen.getByRole("link", { name: "YourTal" })).toHaveAttribute("href", "/id");
    const signUp = screen.getByRole("link", { name: "Daftar gratis" });
    expect(signUp).toHaveAttribute("href", "/onboarding");
  });
});
