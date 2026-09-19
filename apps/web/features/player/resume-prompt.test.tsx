import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResumePrompt } from "./resume-prompt";

describe("ResumePrompt", () => {
  it("offers resume and start-over as an accessible dialog with the prior position stated in plain language", () => {
    render(<ResumePrompt positionSeconds={125} onChoose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Continue watching?" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/watched up to 2:05/);
  });

  it("calls onChoose('resume') when Resume is activated", () => {
    const onChoose = vi.fn();
    render(<ResumePrompt positionSeconds={125} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: /Resume from 2:05/ }));
    expect(onChoose).toHaveBeenCalledWith("resume");
  });

  it("calls onChoose('restart') when Start over is activated", () => {
    const onChoose = vi.fn();
    render(<ResumePrompt positionSeconds={125} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(onChoose).toHaveBeenCalledWith("restart");
  });

  it("defaults a dismiss with no explicit choice (Escape) to restart, never a silent resume", () => {
    const onChoose = vi.fn();
    render(<ResumePrompt positionSeconds={125} onChoose={onChoose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onChoose).toHaveBeenCalledWith("restart");
  });
});
