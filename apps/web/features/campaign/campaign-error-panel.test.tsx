import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CampaignErrorPanel } from "./campaign-error-panel";

describe("CampaignErrorPanel", () => {
  it("announces itself as an alert with the given copy", () => {
    render(<CampaignErrorPanel title="Gagal memuat" description="Coba lagi." onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Gagal memuat");
  });

  it("is recoverable: the retry button calls the handler", () => {
    const onRetry = vi.fn();
    render(<CampaignErrorPanel title="Gagal memuat" description="Coba lagi." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /coba lagi/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
