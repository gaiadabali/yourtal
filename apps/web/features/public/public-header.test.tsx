import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublicHeader } from "./public-header";

describe("PublicHeader", () => {
  it("links the wordmark home and offers a sign-up call to action to onboarding", () => {
    render(<PublicHeader locale="id-ID" homeHref="/id" currentPublicLocale="id" />);
    expect(screen.getByRole("link", { name: "YourTal" })).toHaveAttribute("href", "/id");
    const signUp = screen.getByRole("link", { name: "Daftar gratis" });
    expect(signUp).toHaveAttribute("href", "/onboarding");
  });

  it("offers a log-in link, pointed at /au until /login exists (task 3.5.c)", () => {
    render(<PublicHeader locale="en-AU" homeHref="/au" currentPublicLocale="au" />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/au");
  });

  it("localises the log-in link for id-ID", () => {
    render(<PublicHeader locale="id-ID" homeHref="/id" currentPublicLocale="id" />);
    expect(screen.getByRole("link", { name: "Masuk" })).toHaveAttribute("href", "/au");
  });

  it("offers a language switch, independent of the sign-up/log-in copy's own locale (6.1.b)", () => {
    render(<PublicHeader locale="en-AU" homeHref="/au" currentPublicLocale="au" />);
    const nav = screen.getByRole("navigation", { name: "Language" });
    const english = screen.getByRole("link", { name: "English" });
    const indonesian = screen.getByRole("link", { name: "Bahasa Indonesia" });
    expect(nav).toContainElement(english);
    expect(english).toHaveAttribute("href", "/au");
    expect(english).toHaveAttribute("aria-current", "true");
    expect(indonesian).toHaveAttribute("href", "/id");
    expect(indonesian).not.toHaveAttribute("aria-current");
  });
});
