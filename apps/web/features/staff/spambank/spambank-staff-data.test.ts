import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api/api-fetch";
import { changeAutoreplyAction, updateLeadAction } from "./spambank-staff-actions";
import { optoutLinkWellFormed, readOptoutState, submitOptout } from "./spambank-optout-data";
import { leadQueryString } from "./spambank-staff-data";
import { OPTOUT_DOMAIN, OPTOUT_SIG } from "./spambank-staff-contract";

vi.mock("@/lib/api/api-fetch", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api/env", () => ({ apiInternalUrl: () => "http://api.test" }));

const SIG = "abcdefghijklmnopqrstuv";

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.unstubAllGlobals();
});

describe("the lead query string", () => {
  it("carries only the filters that are set", () => {
    expect(leadQueryString({})).toBe("");
    expect(leadQueryString({ status: "new", q: "bright brews", cursor: "c1" })).toBe(
      "?status=new&q=bright+brews&cursor=c1",
    );
    expect(leadQueryString({ q: "" })).toBe("");
  });
});

describe("the lead and auto-reply writes", () => {
  it("patches a lead with a trimmed note, or null when empty, and an idempotency key", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, data: {} } as never);
    await updateLeadAction("brightbrews.com.au", "contacted", "  Called  ");
    await updateLeadAction("brightbrews.com.au", "customer", "   ");
    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/staff/spambank/leads/brightbrews.com.au");
    expect(init).toMatchObject({ method: "PATCH", body: { status: "contacted", note: "Called" } });
    expect((init!.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
    expect(vi.mocked(apiFetch).mock.calls[1]![2]).toMatchObject({
      body: { status: "customer", note: null },
    });
  });

  it("refuses an unknown status without calling the API", async () => {
    await expect(updateLeadAction("a.com", "won", "")).resolves.toMatchObject({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("posts the contract's body and demands a reason and a sane cap", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, data: {} } as never);
    await changeAutoreplyAction({ tripped: true, reason: " pause " });
    expect(vi.mocked(apiFetch).mock.calls[0]![2]).toMatchObject({
      method: "POST",
      body: { tripped: true, reason: "pause" },
    });
    await expect(changeAutoreplyAction({ tripped: true, reason: "  " })).resolves.toMatchObject({
      ok: false,
    });
    await expect(changeAutoreplyAction({ dailyCap: 0, reason: "x" })).resolves.toMatchObject({
      ok: false,
    });
    await expect(changeAutoreplyAction({ dailyCap: 1.5, reason: "x" })).resolves.toMatchObject({
      ok: false,
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("returns the API's error when it refuses", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 403, code: "forbidden", message: "no" },
    } as never);
    await expect(changeAutoreplyAction({ resume: true, reason: "x" })).resolves.toMatchObject({
      ok: false,
      error: { status: 403 },
    });
  });
});

describe("the opt-out link", () => {
  it("accepts only a host name and a 22-character signature", () => {
    expect(optoutLinkWellFormed("brightbrews.com.au", SIG)).toBe(true);
    expect(optoutLinkWellFormed("brightbrews.com.au", "short")).toBe(false);
    expect(optoutLinkWellFormed("<script>.com", SIG)).toBe(false);
    expect(optoutLinkWellFormed("localhost", SIG)).toBe(false);
    expect(OPTOUT_SIG.test(`${SIG}=`)).toBe(false);
    expect(OPTOUT_DOMAIN.test("a..com")).toBe(false);
  });

  it("is invalid without ever calling the API when the link is malformed", async () => {
    await expect(readOptoutState("nope", SIG)).resolves.toBe("invalid");
    await expect(submitOptout("nope", SIG)).resolves.toBe("invalid");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("reads ready, done, invalid and unavailable from the status endpoint", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: true,
      data: { domain: "a.com", optedOut: false },
    });
    await expect(readOptoutState("a.com", SIG)).resolves.toBe("ready");
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: true,
      data: { domain: "a.com", optedOut: true },
    });
    await expect(readOptoutState("a.com", SIG)).resolves.toBe("done");
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: false,
      error: { kind: "http", status: 404, code: "invalid_link", message: "" },
    });
    await expect(readOptoutState("a.com", SIG)).resolves.toBe("invalid");
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: false,
      error: { kind: "network", message: "down" },
    });
    await expect(readOptoutState("a.com", SIG)).resolves.toBe("unavailable");
    expect(vi.mocked(apiFetch).mock.calls[0]![2]).toMatchObject({ anonymous: true });
  });

  it("opts out with the one-click POST, anonymously and without following redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitOptout("a.com", SIG)).resolves.toBe("done");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://api.test/api/spambank/optout/a.com/${SIG}`);
    expect(init).toMatchObject({
      method: "POST",
      body: "List-Unsubscribe=One-Click",
      redirect: "error",
    });
    expect(init.headers).not.toHaveProperty("authorization");

    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(submitOptout("a.com", SIG)).resolves.toBe("invalid");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(submitOptout("a.com", SIG)).resolves.toBe("unavailable");
    fetchMock.mockRejectedValueOnce(new Error("down"));
    await expect(submitOptout("a.com", SIG)).resolves.toBe("unavailable");
  });
});
