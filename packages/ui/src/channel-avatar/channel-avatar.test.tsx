import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChannelAvatar } from "./channel-avatar";

describe("ChannelAvatar", () => {
  it("derives initials from the name and exposes the name as the accessible label", () => {
    render(<ChannelAvatar name="Bali Coffee Co" />);
    const avatar = screen.getByRole("img", { name: "Bali Coffee Co" });
    expect(avatar).toHaveTextContent("BC");
  });

  it("uses the given initials override instead of deriving them", () => {
    render(<ChannelAvatar name="Bali Coffee Co" initials="bc3" />);
    expect(screen.getByRole("img", { name: "Bali Coffee Co" })).toHaveTextContent("BC3");
  });

  it("renders a real <img> with the name as alt text when src is given", () => {
    render(<ChannelAvatar name="Snap App" src="https://example.com/logo.png" />);
    const img = screen.getByRole("img", { name: "Snap App" });
    expect(img.tagName).toBe("IMG");
  });

  it("picks the same background colour for the same name every render", () => {
    const first = render(<ChannelAvatar name="Repeat Channel" />);
    const firstClass = first.getByRole("img").className;
    first.unmount();
    const second = render(<ChannelAvatar name="Repeat Channel" />);
    expect(second.getByRole("img").className).toBe(firstClass);
  });

  it("handles a single-word name", () => {
    render(<ChannelAvatar name="Wardah" />);
    expect(screen.getByRole("img", { name: "Wardah" })).toHaveTextContent("WA");
  });
});
