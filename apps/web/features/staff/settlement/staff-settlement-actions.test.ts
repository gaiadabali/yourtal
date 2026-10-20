import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api/api-fetch";
import {
  checkDisbursementAction,
  decideRetryAction,
  proposeRetryAction,
} from "./staff-settlement-actions";

vi.mock("@/lib/api/api-fetch", () => ({ apiFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe("disbursement actions send the contract's request shapes (5.2.c)", () => {
  it("checks with an empty body and returns the outcome", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      data: { outcome: "pending", disbursement: {} },
    } as never);
    await expect(checkDisbursementAction("AU", "d-1")).resolves.toEqual({
      ok: true,
      outcome: "pending",
    });
    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/staff/settlement/AU/disbursements/d-1/check");
    expect(init).toMatchObject({ method: "POST", body: {} });
    expect((init!.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
  });

  it("proposes a retry with the trimmed reason, and refuses an empty one", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, data: {} } as never);
    await proposeRetryAction("ID", "d-1", " nothing moved ");
    const [path, , init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/staff/settlement/ID/disbursements/d-1/retry-proposals");
    expect(init).toMatchObject({ body: { reason: "nothing moved" } });
    await expect(proposeRetryAction("ID", "d-1", " ")).resolves.toMatchObject({ ok: false });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("approves and rejects on the retry-proposals routes", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, data: {} } as never);
    await decideRetryAction("AU", "pr-1", "approve");
    await decideRetryAction("AU", "pr-1", "reject");
    expect(vi.mocked(apiFetch).mock.calls.map((call) => call[0])).toEqual([
      "/api/staff/settlement/AU/retry-proposals/pr-1/approve",
      "/api/staff/settlement/AU/retry-proposals/pr-1/reject",
    ]);
  });

  it("hands back the server's message on a 409", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 409, code: "conflict", message: "Already retried." },
    });
    await expect(decideRetryAction("AU", "pr-1", "approve")).resolves.toEqual({
      ok: false,
      message: "Already retried.",
    });
  });
});
