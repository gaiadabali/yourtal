import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAreas from "@/messages/en-AU/areas.json";
import enMe from "@/messages/en-AU/me.json";
import { MeAreaSection } from "./me-area-section";
import { clearAreaAction, setAreaAction } from "./me-actions";

vi.mock("./me-actions", () => ({ setAreaAction: vi.fn(), clearAreaAction: vi.fn() }));
vi.mock("@/features/areas/area-actions", () => ({
  fetchAreaStatesAction: vi.fn().mockResolvedValue({
    ok: true,
    data: { region: "AU", states: [{ code: "NSW", name: "New South Wales", placeCount: 1 }] },
  }),
  fetchAreaPlacesAction: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      region: "AU",
      state: { code: "NSW", name: "New South Wales" },
      places: [{ name: "Bondi", postcode: "2026" }],
    },
  }),
}));

const BONDI = { postcode: "2026", names: ["Bondi", "Bondi Beach"], moreCount: 1, states: ["NSW"] };

function renderSection(initialArea: typeof BONDI | null) {
  render(
    <NextIntlClientProvider locale="en-AU" messages={{ me: enMe, areas: enAreas }}>
      <MeAreaSection initialArea={initialArea} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(setAreaAction).mockReset();
  vi.mocked(clearAreaAction).mockReset();
});

describe("MeAreaSection", () => {
  it("is optional: with no area it says so and offers to choose one", () => {
    renderSection(null);
    expect(screen.getByRole("heading", { name: "My area" })).toBeInTheDocument();
    expect(screen.getByText("You haven't set an area.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Choose my area" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("picks a state, then a suburb, and saves its postcode", async () => {
    vi.mocked(setAreaAction).mockResolvedValue({ ok: true, data: { area: BONDI } });
    const user = userEvent.setup();
    renderSection(null);

    await user.click(screen.getByRole("button", { name: "Choose my area" }));
    await user.click(await screen.findByRole("button", { name: "New South Wales" }));
    await user.click(await screen.findByRole("button", { name: "Bondi" }));

    expect(setAreaAction).toHaveBeenCalledWith("2026");
    expect(await screen.findByText("Bondi, Bondi Beach and 1 more")).toBeVisible();
    expect(screen.getByRole("button", { name: "Change area" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("shows the saved area and clears it", async () => {
    vi.mocked(clearAreaAction).mockResolvedValue({ ok: true, data: { area: null } });
    const user = userEvent.setup();
    renderSection(BONDI);
    expect(screen.getByText("Bondi, Bondi Beach and 1 more")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(clearAreaAction).toHaveBeenCalled();
    expect(await screen.findByText("You haven't set an area.")).toBeVisible();
  });

  it("keeps the picker open and says so when saving fails", async () => {
    vi.mocked(setAreaAction).mockResolvedValue({
      ok: false,
      error: {
        kind: "http",
        status: 400,
        code: "unknown_area",
        message: "Pick an area from the list.",
      },
    });
    const user = userEvent.setup();
    renderSection(null);
    await user.click(screen.getByRole("button", { name: "Choose my area" }));
    await user.click(await screen.findByRole("button", { name: "New South Wales" }));
    await user.click(await screen.findByRole("button", { name: "Bondi" }));

    expect(await screen.findByText("Pick an area from the list.")).toHaveAttribute("role", "alert");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("cancels back to the summary without saving", async () => {
    const user = userEvent.setup();
    renderSection(BONDI);
    await user.click(screen.getByRole("button", { name: "Change area" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setAreaAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Change area" })).toBeInTheDocument();
  });
});
