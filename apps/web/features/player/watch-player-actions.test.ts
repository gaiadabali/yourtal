import { describe, expect, it, vi } from "vitest";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api/api-fetch", () => ({ apiFetch: apiFetchMock }));

describe("watch-player-actions", () => {
  it("starts a session with a fresh idempotency key", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: {} });
    const { startWatchSessionAction } = await import("./watch-player-actions");

    await startWatchSessionAction("campaign-1");

    const [path, , init] = apiFetchMock.mock.calls[0]!;
    expect(path).toBe("/api/watch/sessions");
    expect(init.method).toBe("POST");
    expect(init.body).toEqual({ campaignId: "campaign-1" });
    expect(typeof init.headers["idempotency-key"]).toBe("string");
  });

  it("reports a progress span with fromSeconds/toSeconds/reportedAt", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: {} });
    const { reportWatchProgressAction } = await import("./watch-player-actions");

    await reportWatchProgressAction("session-1", 10, 15);

    const [path, , init] = apiFetchMock.mock.calls[0]!;
    expect(path).toBe("/api/watch/sessions/session-1/progress");
    expect(init.body.fromSeconds).toBe(10);
    expect(init.body.toSeconds).toBe(15);
    expect(typeof init.body.reportedAt).toBe("string");
  });

  it("completes a session with a fresh idempotency key", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: {} });
    const { completeWatchSessionAction } = await import("./watch-player-actions");

    await completeWatchSessionAction("session-1");

    const [path, , init] = apiFetchMock.mock.calls[0]!;
    expect(path).toBe("/api/watch/sessions/session-1/complete");
    expect(init.method).toBe("POST");
    expect(typeof init.headers["idempotency-key"]).toBe("string");
  });

  it("presents a checkpoint by session and index, with no body", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: {} });
    const { presentCheckpointAction } = await import("./watch-player-actions");

    await presentCheckpointAction("session-1", 0);

    const [path, , init] = apiFetchMock.mock.calls[0]!;
    expect(path).toBe("/api/watch/sessions/session-1/checkpoints/0");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("answers a checkpoint with the token and a selected option", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: {} });
    const { answerCheckpointAction } = await import("./watch-player-actions");

    await answerCheckpointAction("session-1", 0, "tok123", "option-a");

    const [path, , init] = apiFetchMock.mock.calls[0]!;
    expect(path).toBe("/api/watch/sessions/session-1/checkpoints/0/answer");
    expect(init.body).toEqual({ token: "tok123", selectedOptionId: "option-a" });
  });

  it("answers a checkpoint with no selection on timeout — never omits the token", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: {} });
    const { answerCheckpointAction } = await import("./watch-player-actions");

    await answerCheckpointAction("session-1", 0, "tok123", null);

    const [, , init] = apiFetchMock.mock.calls[0]!;
    expect(init.body).toEqual({ token: "tok123" });
  });
});
