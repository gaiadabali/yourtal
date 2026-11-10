import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readSessionToken = vi.fn<() => Promise<string | null>>();
vi.mock("@/lib/api/session-cookies", () => ({ readSessionToken }));
vi.mock("@/lib/api/env", () => ({ apiInternalUrl: () => "http://api.test" }));

const { proxyGstReport } = await import("./gst-report-proxy");
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  readSessionToken.mockResolvedValue("tok_123");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("proxyGstReport", () => {
  it("fetches the quarter with the session as a bearer token and streams the CSV as a download", async () => {
    fetchMock.mockResolvedValue(
      new Response("invoice_number\r\n", {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="gst-report-2026-Q4.csv"',
          "set-cookie": "leak=1",
        },
      }),
    );
    const response = await proxyGstReport("2026-Q4");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/staff/invoices/gst-report?quarter=2026-Q4",
      expect.objectContaining({ headers: { authorization: "Bearer tok_123" } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("gst-report-2026-Q4.csv");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe("invoice_number\r\n");
  });

  it("passes a 403 through (not finance) and refuses a malformed quarter without calling the API", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await proxyGstReport("2026-Q4")).status).toBe(403);
    fetchMock.mockClear();
    expect((await proxyGstReport("2026-Q9; drop")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is 401 without a session", async () => {
    readSessionToken.mockResolvedValue(null);
    expect((await proxyGstReport("2026-Q4")).status).toBe(401);
  });
});
