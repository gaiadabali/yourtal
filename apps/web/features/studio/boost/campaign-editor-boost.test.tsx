import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { BoostView } from "@yourtal/contracts/studio/boost";
import enStudio from "@/messages/en-AU/studio.json";
import idStudio from "@/messages/id-ID/studio.json";
import { CampaignEditorBoost } from "./campaign-editor-boost";

const { loadBoost, saveBoost, stopBoost } = vi.hoisted(() => ({
  loadBoost: vi.fn(),
  saveBoost: vi.fn(),
  stopBoost: vi.fn(),
}));
vi.mock("./boost-actions", () => ({ loadBoost, saveBoost, stopBoost }));

const CAMPAIGN = "4b6ab6c1-6a5c-4b4a-9d3c-0e6a1f2b3c4d";
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

function viewOf(overrides: Partial<BoostView> = {}): BoostView {
  return {
    campaignId: CAMPAIGN,
    currency: "AUD",
    setting: {
      dailyBudgetMinor: 500,
      maxBidCpmMinor: 200,
      startsAt: hours(-48),
      endsAt: hours(24 * 14),
      state: "active",
    },
    reserveCpmMinor: 100,
    impressions: 0,
    spendMinor: 0,
    averageCpmMinor: null,
    days: [],
    cardRequired: false,
    ...overrides,
  } as BoostView;
}

async function renderEditor(view: BoostView, locale: "en-AU" | "id-ID" = "en-AU") {
  loadBoost.mockResolvedValue({ ok: true, view });
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ studio: locale === "en-AU" ? enStudio : idStudio }}
    >
      <CampaignEditorBoost businessId="biz-1" campaignId={CAMPAIGN} isLive isLiveMode />
    </NextIntlClientProvider>,
  );
  await screen.findByRole("button", { name: /Save boost|Simpan boost/ });
}

beforeEach(() => {
  loadBoost.mockReset();
  saveBoost.mockReset();
  stopBoost.mockReset();
});

describe("boost bid below the reserve (B12)", () => {
  it("says the lowest bid in the currency, not in minor units, and does not call the server", async () => {
    const user = userEvent.setup();
    await renderEditor(viewOf());
    const bid = screen.getByLabelText(/Maximum bid per 1,000 impressions/);
    await user.clear(bid);
    await user.type(bid, "0.50");

    await user.click(screen.getByRole("button", { name: "Save boost" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The maximum bid must be at least $1.00 per 1,000 impressions");
    expect(alert).not.toHaveTextContent(/reserve of 100/);
    expect(saveBoost).not.toHaveBeenCalled();
  });

  it("words the server's refusal the same way, in Bahasa Indonesia too", async () => {
    saveBoost.mockResolvedValue({
      ok: false,
      code: "bid_below_reserve",
      message: "The maximum bid is below the lowest bid that can win.",
    });
    const user = userEvent.setup();
    // The reserve moved after the page loaded: the form passes, the server refuses.
    await renderEditor(viewOf({ reserveCpmMinor: 50 }), "id-ID");
    const bid = screen.getByLabelText(/Tawaran maksimum per 1.000 tayangan/);
    await user.clear(bid);
    await user.type(bid, "0.60");
    await user.click(screen.getByRole("button", { name: "Simpan boost" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Tawaran maksimum minimal .*0,50 per 1\.000 tayangan/);
  });
});

describe("switching a boost off (B15)", () => {
  it("offers stop now and stop at the end of today, and says served days are still charged", async () => {
    stopBoost.mockResolvedValue({
      ok: true,
      view: viewOf({
        setting: { ...viewOf().setting!, state: "paused" },
      }),
    });
    const user = userEvent.setup();
    await renderEditor(viewOf());

    expect(screen.getByText("Days already served are still charged.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop at the end of today" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop now" }));

    expect(stopBoost).toHaveBeenCalledWith("biz-1", CAMPAIGN, "now");
    expect(await screen.findByText("This boost is off")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop now" })).not.toBeInTheDocument();
  });

  it("stops at the end of the day, and shows when bidding ends", async () => {
    stopBoost.mockResolvedValue({
      ok: true,
      view: viewOf({ setting: { ...viewOf().setting!, endsAt: hours(6) } }),
    });
    const user = userEvent.setup();
    await renderEditor(viewOf());

    await user.click(screen.getByRole("button", { name: "Stop at the end of today" }));

    expect(stopBoost).toHaveBeenCalledWith("biz-1", CAMPAIGN, "end_of_day");
    expect(await screen.findByText(/Bidding ends /)).toBeInTheDocument();
  });

  it("shows a failed stop and keeps the boost as it was", async () => {
    stopBoost.mockResolvedValue({
      ok: false,
      code: null,
      message: "The request couldn't reach YourTal.",
    });
    const user = userEvent.setup();
    await renderEditor(viewOf());

    await user.click(screen.getByRole("button", { name: "Stop now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach");
    expect(screen.getByRole("button", { name: "Stop now" })).toBeInTheDocument();
  });

  it("shows an already-stopped boost as off, with no stop buttons", async () => {
    await renderEditor(viewOf({ setting: { ...viewOf().setting!, state: "paused" } }));

    expect(screen.getByText("This boost is off")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop now" })).not.toBeInTheDocument();
  });

  it("has nothing to stop before a boost is set", async () => {
    await renderEditor(viewOf({ setting: null }));

    expect(screen.queryByText("Stop this boost")).not.toBeInTheDocument();
  });

  it("speaks Bahasa Indonesia", async () => {
    await renderEditor(viewOf(), "id-ID");

    expect(screen.getByRole("button", { name: "Hentikan sekarang" })).toBeInTheDocument();
    expect(screen.getByText("Hari yang sudah tayang tetap ditagih.")).toBeInTheDocument();
  });
});
