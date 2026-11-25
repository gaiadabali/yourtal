import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("../studio-data", () => ({
  updateChannelSettings: updateMock,
  ChannelSettingsError: class ChannelSettingsError extends Error {
    constructor(
      readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { ChannelSettingsError } from "../studio-data";
import { updateChannelAction } from "./update-channel-action";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000601";

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields = {
    businessId: BUSINESS_ID,
    displayName: "Kopi Kenangan",
    handle: "kopi-kenangan",
    logoUrl: "https://cdn.example.com/logo.png",
    coverUrl: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("updateChannelAction", () => {
  beforeEach(() => updateMock.mockReset());

  it("saves, sending an empty link as null, and redirects with the saved flag", async () => {
    updateMock.mockResolvedValue({});
    await expect(updateChannelAction(form())).rejects.toThrow("REDIRECT:/studio/channel?saved=1");
    expect(updateMock).toHaveBeenCalledWith(BUSINESS_ID, {
      displayName: "Kopi Kenangan",
      handle: "kopi-kenangan",
      logoUrl: "https://cdn.example.com/logo.png",
      coverUrl: null,
    });
  });

  it("refuses an http image link or a bad handle without calling the API", async () => {
    await expect(updateChannelAction(form({ logoUrl: "http://x.example/l.png" }))).rejects.toThrow(
      "REDIRECT:/studio/channel?error=invalid_input",
    );
    await expect(updateChannelAction(form({ handle: "Bad Handle" }))).rejects.toThrow(
      "REDIRECT:/studio/channel?error=invalid_input",
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("says when the handle is taken, and shows a plain failure otherwise", async () => {
    updateMock.mockRejectedValueOnce(new ChannelSettingsError("handle_taken", "taken"));
    await expect(updateChannelAction(form())).rejects.toThrow(
      "REDIRECT:/studio/channel?error=handle_taken",
    );
    updateMock.mockRejectedValueOnce(new Error("boom"));
    await expect(updateChannelAction(form())).rejects.toThrow(
      "REDIRECT:/studio/channel?error=save_failed",
    );
  });
});
