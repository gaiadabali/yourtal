import { beforeEach, describe, expect, it, vi } from "vitest";

let cookieHeader: string | null = null;
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(new Headers(cookieHeader === null ? {} : { cookie: cookieHeader })),
}));

const apiFetch = vi.fn<(path: string) => Promise<unknown>>();
vi.mock("@/lib/api/api-fetch", () => ({
  apiFetch: (path: string): Promise<unknown> => apiFetch(path),
}));

const { loadInteraction } = await import("./connect-api");

beforeEach(() => {
  vi.clearAllMocks();
  cookieHeader = null;
});

describe("loadInteraction", () => {
  it("answers no-cookie, without asking the API, when the request has no interaction cookie", async () => {
    cookieHeader = "yt_session=abc; theme=dark";
    await expect(loadInteraction("uid_1")).resolves.toEqual({ kind: "no-cookie" });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("answers ended when the API rejects the cookie it was sent", async () => {
    cookieHeader = "_interaction=abc; _interaction.sig=def";
    apiFetch.mockResolvedValue({ ok: false, error: { kind: "http", status: 404 } });
    await expect(loadInteraction("uid_1")).resolves.toEqual({ kind: "ended" });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("answers unavailable for any other failure", async () => {
    cookieHeader = "_interaction=abc";
    apiFetch.mockResolvedValue({ ok: false, error: { kind: "http", status: 500 } });
    await expect(loadInteraction("uid_1")).resolves.toEqual({ kind: "unavailable" });
  });
});
