import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readSessionToken = vi.fn<() => Promise<string | null>>();
vi.mock("@/lib/api/session-cookies", () => ({ readSessionToken }));
vi.mock("@/lib/api/env", () => ({ apiInternalUrl: () => "http://api.test" }));

const { proxyInvoicePdf } = await import("./invoice-pdf-proxy");

const BUSINESS = "0b9a3d8e-1f32-4f0c-8d8c-0f1e2d3c4b5a";
const INVOICE = "5f0a3a8e-6a0e-4b0b-9a53-9d0a4f4b1c11";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  readSessionToken.mockResolvedValue("tok_123");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("proxyInvoicePdf", () => {
  it("fetches the invoice with the session as a bearer token and streams the PDF as a download", async () => {
    fetchMock.mockResolvedValue(
      new Response("%PDF-1.3 body", {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="YT-AU-000042.pdf"',
          "set-cookie": "leak=1",
        },
      }),
    );
    const response = await proxyInvoicePdf(BUSINESS, INVOICE);

    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/api/${BUSINESS}/studio/invoices/${INVOICE}/pdf`,
      expect.objectContaining({ headers: { authorization: "Bearer tok_123" } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="YT-AU-000042.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe("%PDF-1.3 body");
  });

  it("passes the API's refusal through and never asks the API for a malformed id", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    expect((await proxyInvoicePdf(BUSINESS, INVOICE)).status).toBe(404);
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    expect((await proxyInvoicePdf(BUSINESS, INVOICE)).status).toBe(403);
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    expect((await proxyInvoicePdf(BUSINESS, INVOICE)).status).toBe(502);

    fetchMock.mockClear();
    expect((await proxyInvoicePdf("../../x", INVOICE)).status).toBe(404);
    expect((await proxyInvoicePdf(BUSINESS, "not-a-uuid")).status).toBe(404);
    expect((await proxyInvoicePdf("", INVOICE)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is 401 with no session, and 502 when the API cannot be reached", async () => {
    readSessionToken.mockResolvedValue(null);
    expect((await proxyInvoicePdf(BUSINESS, INVOICE)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    readSessionToken.mockResolvedValue("tok_123");
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect((await proxyInvoicePdf(BUSINESS, INVOICE)).status).toBe(502);
  });
});
