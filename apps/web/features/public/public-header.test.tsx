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

  it("offers a log-in link, pointed at /au until /login exists (task 3.5.c)", () => {
    render(<PublicHeader locale="en-AU" homeHref="/au" />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/au");
  });

  it("localises the log-in link for id-ID", () => {
    render(<PublicHeader locale="id-ID" homeHref="/id" />);
    expect(screen.getByRole("link", { name: "Masuk" })).toHaveAttribute("href", "/au");
  });
});
