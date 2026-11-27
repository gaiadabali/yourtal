import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthCard } from "./auth-card";

describe("AuthCard", () => {
  it("is the page's one <main>, with the heading and the card inside it", () => {
    render(
      <AuthCard title="Sign in" footer={<a href="/register">Sign up</a>}>
        <button type="button">Go</button>
      </AuthCard>,
    );
    const main = screen.getByRole("main");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(main).toContainElement(screen.getByRole("heading", { level: 1, name: "Sign in" }));
    expect(main).toContainElement(screen.getByRole("button", { name: "Go" }));
    expect(main).toContainElement(screen.getByRole("link", { name: "Sign up" }));
  });
});
