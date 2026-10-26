import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  viewerShell: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock("@/features/notifications/notifications-data", () => ({
  getNotifications: mocks.getNotifications,
}));
vi.mock("@/features/wallet/wallet-data", () => ({
  getWalletBalance: () => Promise.resolve({ ok: true, data: { availablePoints: 5 } }),
}));
vi.mock("@/features/me/me-data", () => ({
  getMeProfile: () => Promise.resolve({ ok: false, error: { kind: "network", message: "x" } }),
}));
vi.mock("@/features/rum/rum-reporter-loader", () => ({ RumReporterLoader: () => null }));
vi.mock("@/features/region/get-region", () => ({ getRegion: () => Promise.resolve("AU") }));
vi.mock("@/i18n/get-locale", () => ({ getDisplayLocale: () => Promise.resolve("en-AU") }));
vi.mock("@/lib/api/session-cookies", () => ({ readThemeCookie: () => Promise.resolve("system") }));
vi.mock("@/lib/api/api-fetch", () => ({
  apiFetch: () => Promise.resolve({ ok: false, error: { kind: "network", message: "x" } }),
}));
vi.mock("./viewer-shell", () => ({ ViewerShell: mocks.viewerShell }));

import { AppShell } from "./app-shell";

async function shellProps(): Promise<Record<string, unknown>> {
  const element = await AppShell({ children: null });
  // The shell's own element tree is `<><RumReporterLoader /><ViewerShell … /></>`.
  const children = (element as { props: { children: { props: Record<string, unknown> }[] } }).props
    .children;
  const viewerShell = children[1];
  if (viewerShell === undefined) throw new Error("no ViewerShell element");
  return viewerShell.props;
}

beforeEach(() => {
  mocks.getNotifications.mockReset();
});

describe("AppShell bell", () => {
  it("gives a signed-out visitor the signed-out shell, not a bell (the notifications read is a 401)", async () => {
    mocks.getNotifications.mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 401, code: "no_session", message: "no session" },
    });
    const props = await shellProps();
    expect(props).not.toHaveProperty("notifications");
    expect(props).toMatchObject({
      signedOut: {
        homeHref: "/au",
        signUpHref: "/register",
        signUpLabel: "Sign up to earn",
        hrefs: { wallet: "/login?returnTo=%2Fwallet", me: "/login?returnTo=%2Fme" },
      },
    });
  });

  it("gives a signed-in viewer the bell, empty when they have none", async () => {
    mocks.getNotifications.mockResolvedValue({ ok: true, data: { notifications: [] } });
    expect(await shellProps()).toHaveProperty("notifications", []);
  });

  it("keeps the bell, empty, when the read fails for another reason", async () => {
    mocks.getNotifications.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "offline" },
    });
    expect(await shellProps()).toHaveProperty("notifications", []);
  });
});
