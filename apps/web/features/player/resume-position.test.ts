import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearResumePosition, readResumePosition, writeResumePosition } from "./resume-position";

describe("resume-position", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a written position", () => {
    writeResumePosition({ campaignId: "abc", positionSeconds: 245, updatedAt: "2026-09-19T09:00:00.000Z" });
    expect(readResumePosition("abc")).toEqual({
      campaignId: "abc",
      positionSeconds: 245,
      updatedAt: "2026-09-19T09:00:00.000Z",
    });
  });

  it("returns null when nothing has been written for this campaign", () => {
    expect(readResumePosition("never-watched")).toBeNull();
  });

  it("treats a corrupted (non-JSON) stored value as no prior position, never throwing", () => {
    window.localStorage.setItem("yourtal:watch:resume:corrupt", "{not json");
    expect(() => readResumePosition("corrupt")).not.toThrow();
    expect(readResumePosition("corrupt")).toBeNull();
  });

  it("treats a value that fails schema validation (wrong shape) as no prior position", () => {
    window.localStorage.setItem("yourtal:watch:resume:bad-shape", JSON.stringify({ positionSeconds: "not a number" }));
    expect(readResumePosition("bad-shape")).toBeNull();
  });

  it("does not throw when localStorage.getItem itself throws (private-mode simulation)", () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    expect(() => readResumePosition("anything")).not.toThrow();
    expect(readResumePosition("anything")).toBeNull();
    spy.mockRestore();
  });

  it("does not throw when localStorage.setItem itself throws (quota-exceeded simulation)", () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() =>
      writeResumePosition({ campaignId: "quota", positionSeconds: 10, updatedAt: "2026-09-19T09:00:00.000Z" }),
    ).not.toThrow();
    spy.mockRestore();
  });

  it("clears a stored position", () => {
    writeResumePosition({ campaignId: "clear-me", positionSeconds: 99, updatedAt: "2026-09-19T09:00:00.000Z" });
    clearResumePosition("clear-me");
    expect(readResumePosition("clear-me")).toBeNull();
  });
});
