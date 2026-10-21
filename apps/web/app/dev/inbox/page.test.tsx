import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DevInboxResponse } from "@/lib/api/dev-inbox-schema";
import DevInboxPage from "./page";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api/api-fetch", () => ({ apiFetch: mocks.apiFetch }));

const entry = {
  id: "e1",
  boundary: "email",
  region: "AU",
  recipient: "viewer@example.test",
  category: "email_verification",
  subject: "Verify your email",
  body: "Open this link to verify.",
  metadata: {},
  createdAt: "2026-10-21T00:00:00.000Z",
} as const;

function ok(data: DevInboxResponse) {
  mocks.apiFetch.mockResolvedValue({ ok: true, data });
}

async function renderPage() {
  render(await DevInboxPage());
}

afterEach(() => vi.resetAllMocks());

describe("the dev inbox page (5.13.b)", () => {
  it("reads through apiFetch, which forwards the viewer's session", async () => {
    ok({ access: "open", viewerEmail: null, entries: [] });
    await renderPage();
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/dev/inbox", expect.anything());
  });

  it("asks a signed-out viewer to sign in to see their own emails", async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 401, code: "no_session", message: "sign in to continue" },
    });
    await renderPage();
    expect(screen.getByTestId("inbox-signed-out")).toHaveTextContent(
      "Sign in to see your own emails.",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fdev%2Finbox",
    );
  });

  it("says whose emails a signed-in viewer is looking at", async () => {
    ok({ access: "own", viewerEmail: "viewer@example.test", entries: [entry] });
    await renderPage();
    expect(screen.getByTestId("inbox-whose")).toHaveTextContent(
      "Signed in as viewer@example.test. These are the messages sent to you.",
    );
    expect(screen.getByText("To: viewer@example.test")).toBeInTheDocument();
  });

  it("tells staff they see everyone's messages", async () => {
    ok({ access: "staff", viewerEmail: "staff@example.test", entries: [entry] });
    await renderPage();
    expect(screen.getByTestId("inbox-whose")).toHaveTextContent(
      "Signed in as staff@example.test. You are staff, so you see everyone's messages.",
    );
  });

  it("says a local dev run shows everyone's messages", async () => {
    ok({ access: "open", viewerEmail: null, entries: [] });
    await renderPage();
    expect(screen.getByTestId("inbox-whose")).toHaveTextContent("Everyone's messages.");
    expect(screen.getByText("Nothing sent yet.")).toBeInTheDocument();
  });

  it("shows any other refusal, such as production's 404, rather than hiding it", async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 404, code: "http_404", message: "Not Found" },
    });
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("GET /api/dev/inbox returned 404");
  });
});
