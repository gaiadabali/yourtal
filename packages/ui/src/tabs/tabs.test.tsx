import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function renderTabs() {
  return render(
    <Tabs defaultValue="earn">
      <TabsList aria-label="Wallet sections">
        <TabsTrigger value="earn">Earn</TabsTrigger>
        <TabsTrigger value="spend">Spend</TabsTrigger>
      </TabsList>
      <TabsContent value="earn">Earn panel</TabsContent>
      <TabsContent value="spend">Spend panel</TabsContent>
    </Tabs>,
  );
}

describe("Tabs", () => {
  it("exposes tablist/tab/tabpanel roles and shows only the active panel", () => {
    renderTabs();
    expect(screen.getByRole("tablist", { name: "Wallet sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Earn" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Spend" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel", { name: "Earn" })).toHaveTextContent("Earn panel");
  });

  it("switches panels on click", async () => {
    renderTabs();
    // Radix Tabs activates on mousedown (a real click starts with one), not on the synthetic "click" event alone.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Spend" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Spend" })).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByRole("tabpanel", { name: "Spend" })).toHaveTextContent("Spend panel");
  });

  it("moves selection with ArrowRight/ArrowLeft (roving tabindex)", async () => {
    renderTabs();
    const earnTab = screen.getByRole("tab", { name: "Earn" });
    const spendTab = screen.getByRole("tab", { name: "Spend" });

    earnTab.focus();
    fireEvent.keyDown(earnTab, { key: "ArrowRight" });
    // Radix moves focus to the next roving item in a microtask/timeout.
    await waitFor(() => expect(spendTab).toHaveFocus());
    await waitFor(() => expect(spendTab).toHaveAttribute("aria-selected", "true"));

    fireEvent.keyDown(spendTab, { key: "ArrowLeft" });
    await waitFor(() => expect(earnTab).toHaveFocus());
    await waitFor(() => expect(earnTab).toHaveAttribute("aria-selected", "true"));
  });
});
