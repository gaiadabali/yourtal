import { describe, expect, it } from "vitest";
import { checkpointPollDue } from "./use-watch-earn-session";

const base = { paused: false, ended: false, currentTime: 45, askFrom: 0, asked: 0, total: 1 };

describe("checkpointPollDue", () => {
  it("asks while playing once past where an earlier attempt stopped", () => {
    expect(checkpointPollDue(base)).toBe(true);
    expect(checkpointPollDue({ ...base, askFrom: 60 })).toBe(false);
  });

  it("asks when the video has ended, wherever the playhead stopped", () => {
    expect(
      checkpointPollDue({ ...base, paused: true, ended: true, currentTime: 0, askFrom: 60 }),
    ).toBe(true);
  });

  it("asks while paused partway through, but not before anything has played", () => {
    expect(checkpointPollDue({ ...base, paused: true })).toBe(true);
    expect(checkpointPollDue({ ...base, paused: true, currentTime: 0 })).toBe(false);
  });

  it("never asks once every question is answered", () => {
    expect(checkpointPollDue({ ...base, ended: true, asked: 1 })).toBe(false);
    expect(checkpointPollDue({ ...base, ended: true, total: 0 })).toBe(false);
  });
});
