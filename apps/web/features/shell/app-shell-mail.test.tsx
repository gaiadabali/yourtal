import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  getMailboxStatus: vi.fn(),
  getMeProfile: vi.fn(),
  viewerShell: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock("@/features/notifications/notifications-data", () => ({
  getNotifications: () => Promise.resolve({ ok: true, data: { notifications: [] } }),
}));
vi.mock("@/features/wallet/wallet-data", () => ({
  getWalletBalance: () => Promise.resolve({ ok: true, data: { availablePoints: 5 } }),
}));
vi.mock("@/features/me/me-data", () => ({ getMeProfile: mocks.getMeProfile }));
vi.mock("@/features/rum/rum-reporter-loader", () => ({ RumReporterLoader: () => null }));
vi.mock("@/features/region/get-region", () => ({ getRegion: () => Promise.resolve("AU") }));
vi.mock("@/i18n/get-locale", () => ({ getDisplayLocale: () => Promise.resolve("en-AU") }));
vi.mock("@/lib/api/session-cookies", () => ({ readThemeCookie: () => Promise.resolve("system") }));
vi.mock("@/lib/api/api-fetch", () => ({
  apiFetch: () => Promise.resolve({ ok: true, data: { currentLength: 0 } }),
}));
vi.mock("@/features/spambank/spambank-data", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMailboxStatus: mocks.getMailboxStatus,
}));
vi.mock("./viewer-shell", () => ({ ViewerShell: mocks.viewerShell }));

import { AppShell } from "./app-shell";

const profile = (ageBand: "adult" | "teen") => ({
  ok: true,
  data: {
    profile: { ageBand, displayName: "Gee", displayLocale: "en-AU", region: "AU" },
    email: "gee@example.com",
    businessMemberships: [],
    staffRoles: [],
  },
});
const mailbox = (state: string) => ({ ok: true, data: { available: true, state } });

/** The shell's element tree: `<><RumReporterLoader /><ViewerShell /></>`. */
async function shellProps(): Promise<Record<string, unknown>> {
  const element = (await AppShell({ children: null })) as ReactElement<{
    children: ReactElement[];
  }>;
  const shell = element.props.children[1];
  if (shell === undefined) throw new Error("no shell");
  expect(shell.type).toBe(mocks.viewerShell);
  return shell.props as Record<string, unknown>;
}

beforeEach(() => {
  mocks.getMailboxStatus.mockReset();
  mocks.getMeProfile.mockReset();
});

describe("AppShell Mail entry (Spambank)", () => {
  it("gives an adult with a mailbox the Mail entry with the live badge", async () => {
    mocks.getMeProfile.mockResolvedValue(profile("adult"));
    mocks.getMailboxStatus.mockResolvedValue(mailbox("on"));
    expect(await shellProps()).toMatchObject({ mail: { on: true } });
  });

  it("gives the GOD bar the same signal: Spambank for an adult, never for a teen", async () => {
    mocks.getMeProfile.mockResolvedValue(profile("adult"));
    mocks.getMailboxStatus.mockResolvedValue(mailbox("off"));
    expect(await shellProps()).toMatchObject({ godBar: { adult: true } });
    mocks.getMeProfile.mockResolvedValue(profile("teen"));
    mocks.getMailboxStatus.mockResolvedValue(mailbox("on"));
    expect(await shellProps()).toMatchObject({ godBar: { adult: false } });
  });

  it("shows an adult without a mailbox the entry, but no badge", async () => {
    mocks.getMeProfile.mockResolvedValue(profile("adult"));
    mocks.getMailboxStatus.mockResolvedValue(mailbox("off"));
    expect(await shellProps()).toMatchObject({ mail: { on: false } });
  });

  it("never shows Mail to a teen, even if the status said otherwise", async () => {
    mocks.getMeProfile.mockResolvedValue(profile("teen"));
    mocks.getMailboxStatus.mockResolvedValue(mailbox("on"));
    expect(await shellProps()).not.toHaveProperty("mail");
  });

  it("hides Mail when the API says teen (not_allowed) or the feature is off", async () => {
    mocks.getMeProfile.mockResolvedValue(profile("adult"));
    mocks.getMailboxStatus.mockResolvedValue(mailbox("not_allowed"));
    expect(await shellProps()).not.toHaveProperty("mail");
    mocks.getMailboxStatus.mockResolvedValue({ ok: true, data: { available: false } });
    expect(await shellProps()).not.toHaveProperty("mail");
  });
});
