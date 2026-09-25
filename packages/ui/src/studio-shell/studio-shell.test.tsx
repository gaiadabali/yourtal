import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudioShell } from "./studio-shell";

describe("StudioShell", () => {
  it("sets data-surface=studio and renders the nav and children slots", () => {
    const { container } = render(
      <StudioShell nav={<a href="/campaigns">Campaigns</a>}>
        <p>Report content</p>
      </StudioShell>,
    );
    expect(container.firstChild).toHaveAttribute("data-surface", "studio");
    expect(screen.getByRole("link", { name: "Campaigns" })).toBeInTheDocument();
    expect(screen.getByText("Report content")).toBeInTheDocument();
  });

  it("renders the header slot when given one", () => {
    render(<StudioShell nav={<span />} header={<h1>Campaigns</h1>} children="body" />);
    expect(screen.getByRole("heading", { name: "Campaigns" })).toBeInTheDocument();
  });

  it("renders no header row when none is given", () => {
    render(<StudioShell nav={<span />} children="body" />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders the nav slot exactly once, not duplicated for each breakpoint", () => {
    render(<StudioShell nav={<a href="/campaigns">Campaigns</a>} children="body" />);
    expect(screen.getAllByRole("link", { name: "Campaigns" })).toHaveLength(1);
  });
});
