import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAreas from "@/messages/en-AU/areas.json";
import enStudio from "@/messages/en-AU/studio.json";
import enTaxonomy from "@/messages/en-AU/taxonomy.json";
import { CampaignEditorTargeting } from "./campaign-editor-targeting";
import type { CampaignTargeting } from "./campaign-draft";

vi.mock("@/features/areas/area-actions", () => ({
  fetchAreaStatesAction: vi.fn().mockResolvedValue({
    ok: true,
    data: { region: "AU", states: [{ code: "NSW", name: "New South Wales", placeCount: 2 }] },
  }),
  fetchAreaPlacesAction: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      region: "AU",
      state: { code: "NSW", name: "New South Wales" },
      places: [
        { name: "Bondi", postcode: "2026" },
        { name: "Pyrmont", postcode: "2009" },
      ],
    },
  }),
  fetchAreaSummariesAction: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      region: "AU",
      areas: [{ postcode: "2026", names: ["Bondi", "Bondi Beach"], moreCount: 0, states: ["NSW"] }],
    },
  }),
}));

function renderTargeting(districts: string[], onChange = vi.fn()) {
  const targeting: CampaignTargeting = { interests: [], districts };
  render(
    <NextIntlClientProvider
      locale="en-AU"
      messages={{ studio: enStudio, areas: enAreas, taxonomy: enTaxonomy }}
    >
      <CampaignEditorTargeting targeting={targeting} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return onChange;
}

beforeEach(() => vi.clearAllMocks());

describe("CampaignEditorTargeting districts (F116)", () => {
  it("says the campaign targets everyone until an area is picked", () => {
    renderTargeting([]);
    expect(screen.getByText(/No districts added/)).toBeVisible();
  });

  it("shows each chosen postcode with the suburbs it covers, and removes it", async () => {
    const user = userEvent.setup();
    const onChange = renderTargeting(["2026", "2009"]);

    expect(await screen.findByText("2026 · Bondi, Bondi Beach")).toBeVisible();
    // A postcode the list cannot name still shows, as itself.
    expect(screen.getByText("2009")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Remove 2026/ }));
    expect(onChange).toHaveBeenCalledWith({ interests: [], districts: ["2009"] });
  });

  it("adds a postcode by picking a state and then a suburb, never by typing one", async () => {
    const user = userEvent.setup();
    const onChange = renderTargeting(["2009"]);

    await user.click(await screen.findByRole("button", { name: "New South Wales" }));
    await user.click(await screen.findByRole("button", { name: "Bondi" }));

    expect(onChange).toHaveBeenCalledWith({ interests: [], districts: ["2009", "2026"] });
  });

  it("stops at the most areas allowed", async () => {
    const full = Array.from({ length: 20 }, (_, index) => String(2000 + index));
    renderTargeting(full);
    expect(await screen.findByText(/most areas allowed \(20\)/)).toBeVisible();
    expect(await screen.findByRole("button", { name: "New South Wales" })).toBeDisabled();
  });
});
