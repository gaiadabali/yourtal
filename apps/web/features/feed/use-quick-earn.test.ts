import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQuickEarn } from "./use-quick-earn";
import { startWatchAction } from "./feed-actions";

vi.mock("./feed-actions", () => ({
  startWatchAction: vi.fn(),
  reportWatchProgressAction: vi.fn(),
  completeWatchAction: vi.fn(),
}));

describe("useQuickEarn", () => {
  // 12.2.b: a teen's quiet-hours refusal is its OWN phase, not lumped in
  // with "failed" -- the UI reads it to show a kind explanation rather than
  // a generic "we couldn't record that watch" with a retry button that
  // would not help until quiet hours end.
  it("starting during a teen's quiet hours lands on the quiet_hours phase, not failed", async () => {
    vi.mocked(startWatchAction).mockResolvedValue({
      ok: false,
      error: { kind: "http", status: 403, code: "teen_quiet_hours", message: "quiet hours" },
    });
    const { result } = renderHook(() => useQuickEarn("campaign-1"));

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.phase.kind).toBe("quiet_hours"));
  });

  it("an ordinary server failure still lands on the generic failed phase", async () => {
    vi.mocked(startWatchAction).mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "offline" },
    });
    const { result } = renderHook(() => useQuickEarn("campaign-2"));

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.phase.kind).toBe("failed"));
  });
});
