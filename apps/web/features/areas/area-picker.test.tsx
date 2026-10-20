import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAreas from "@/messages/en-AU/areas.json";
import { AreaPicker } from "./area-picker";
import { fetchAreaPlacesAction, fetchAreaStatesAction } from "./area-actions";

vi.mock("./area-actions", () => ({
  fetchAreaStatesAction: vi.fn(),
  fetchAreaPlacesAction: vi.fn(),
}));

const STATES = {
  ok: true as const,
  data: {
    region: "AU" as const,
    states: [
      { code: "NSW", name: "New South Wales", placeCount: 5 },
      { code: "TAS", name: "Tasmania", placeCount: 1 },
    ],
  },
};
const NSW = {
  ok: true as const,
  data: {
    region: "AU" as const,
    state: { code: "NSW", name: "New South Wales" },
    places: [
      { name: "Abbotsford", postcode: "2046" },
      { name: "Bondi", postcode: "2026" },
      { name: "Bondi Junction", postcode: "2022" },
      { name: "Melbourne", postcode: "3000" },
      { name: "Melbourne", postcode: "3004" },
    ],
  },
};

function renderPicker(props: Partial<React.ComponentProps<typeof AreaPicker>> = {}) {
  const onPick = vi.fn();
  render(
    <NextIntlClientProvider locale="en-AU" messages={{ areas: enAreas }}>
      <AreaPicker onPick={onPick} {...props} />
    </NextIntlClientProvider>,
  );
  return onPick;
}

beforeEach(() => {
  vi.mocked(fetchAreaStatesAction).mockReset().mockResolvedValue(STATES);
  vi.mocked(fetchAreaPlacesAction).mockReset().mockResolvedValue(NSW);
});

describe("AreaPicker", () => {
  it("shows the states, then a state's suburbs grouped by letter, and picks a suburb without a postcode being typed", async () => {
    const user = userEvent.setup();
    const onPick = renderPicker();

    expect(await screen.findByRole("button", { name: "New South Wales" })).toBeInTheDocument();
    expect(screen.getByText("Choose a state or territory to see its suburbs.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "New South Wales" }));
    const list = await screen.findByRole("region", { name: "Suburbs in New South Wales" });
    expect(within(list).getByRole("button", { name: "Abbotsford" })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: /Bondi/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "B" }));
    await user.click(within(list).getByRole("button", { name: "Bondi Junction" }));
    expect(onPick).toHaveBeenCalledWith({ name: "Bondi Junction", postcode: "2022" });
    expect(fetchAreaPlacesAction).toHaveBeenCalledWith("NSW");
  });

  it("filters by suburb name across the whole state, and never by postcode", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByRole("button", { name: "New South Wales" }));
    const filter = await screen.findByLabelText("Find a suburb in New South Wales");

    await user.type(filter, "bondi");
    const list = screen.getByRole("region", { name: "Suburbs in New South Wales" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Bondi", "Bondi Junction"]);

    await user.clear(filter);
    await user.type(filter, "2026");
    expect(screen.getByText("No suburb matches “2026”.")).toBeVisible();
  });

  it("tells apart a suburb that has two postcodes, and only then shows the postcode", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByRole("button", { name: "New South Wales" }));
    await user.click(await screen.findByRole("button", { name: "M" }));
    const list = screen.getByRole("region", { name: "Suburbs in New South Wales" });
    expect(
      within(list).getByRole("button", { name: /^Melbourne\s*·\s*3000$/ }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("button", { name: /^Melbourne\s*·\s*3004$/ }),
    ).toBeInTheDocument();
  });

  it("marks chosen postcodes as added and cannot pick them again", async () => {
    const user = userEvent.setup();
    const onPick = renderPicker({ chosen: ["2046"] });
    await user.click(await screen.findByRole("button", { name: "New South Wales" }));
    const added = await screen.findByRole("button", { name: /Abbotsford/ });
    expect(added).toBeDisabled();
    expect(added).toHaveTextContent("Added");
    await user.click(added);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("says so when the list of states cannot be loaded, and retries", async () => {
    vi.mocked(fetchAreaStatesAction).mockResolvedValueOnce({
      ok: false,
      error: { kind: "network", message: "offline" },
    });
    const user = userEvent.setup();
    renderPicker();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load the list of areas.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Tasmania" })).toBeInTheDocument();
  });

  it("says so when a state's suburbs cannot be loaded", async () => {
    vi.mocked(fetchAreaPlacesAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 500, code: "x", message: "boom" },
    });
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByRole("button", { name: "Tasmania" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("is inert while disabled", async () => {
    renderPicker({ disabled: true });
    expect(await screen.findByRole("button", { name: "Tasmania" })).toBeDisabled();
  });
});
