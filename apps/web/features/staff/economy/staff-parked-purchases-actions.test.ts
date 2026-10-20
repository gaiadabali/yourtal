import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api/api-fetch";
import { decideRefundAction, proposeRefundAction } from "./staff-parked-purchases-actions";

vi.mock("@/lib/api/api-fetch", () => ({ apiFetch: vi.fn() }));

const ok = { ok: true, data: {} } as never;

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe("refund actions send the contract's request shapes", () => {
  it("proposes with the trimmed reason and an idempotency key", async () => {
    vi.mocked(apiFetch).mockResolvedValue(ok);
    await expect(proposeRefundAction("AU", "p-1", "  rate rose  ")).resolves.toEqual({ ok: true });
    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/staff/economy/AU/parked-purchases/p-1/refund-proposals");
    expect(init).toMatchObject({ method: "POST", body: { reason: "rate rose" } });
    expect((init!.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
  });

  it("refuses an empty or over-long reason without calling the API", async () => {
    await expect(proposeRefundAction("AU", "p-1", "   ")).resolves.toMatchObject({ ok: false });
    await expect(proposeRefundAction("AU", "p-1", "x".repeat(501))).resolves.toMatchObject({
      ok: false,
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("approves and rejects on the refund-proposals routes", async () => {
    vi.mocked(apiFetch).mockResolvedValue(ok);
    await decideRefundAction("ID", "prop-9", "approve");
    await decideRefundAction("ID", "prop-9", "reject");
    const paths = vi.mocked(apiFetch).mock.calls.map((call) => call[0]);
    expect(paths).toEqual([
      "/api/staff/economy/ID/refund-proposals/prop-9/approve",
      "/api/staff/economy/ID/refund-proposals/prop-9/reject",
    ]);
  });

  it("hands back the server's message on a refusal", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      error: {
        kind: "http",
        status: 403,
        code: "forbidden",
        message: "Not your proposal to approve.",
      },
    });
    await expect(decideRefundAction("AU", "prop-9", "approve")).resolves.toEqual({
      ok: false,
      message: "Not your proposal to approve.",
    });
  });
});
