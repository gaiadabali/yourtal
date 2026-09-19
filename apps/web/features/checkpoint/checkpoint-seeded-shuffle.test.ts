import { describe, expect, it, vi } from "vitest";
import { seededShuffle } from "./checkpoint-seeded-shuffle";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

describe("seededShuffle", () => {
  it("is deterministic: the same seed parts always produce the same order", () => {
    const first = seededShuffle(items, ["campaign-1", "question-1", "respondent-1"]);
    const second = seededShuffle(items, ["campaign-1", "question-1", "respondent-1"]);
    expect(second).toStrictEqual(first);
  });

  it("returns a permutation: same elements, same length, nothing dropped or duplicated", () => {
    const shuffled = seededShuffle(items, ["campaign-1", "question-1", "respondent-1"]);
    expect(shuffled).toHaveLength(items.length);
    expect(new Set(shuffled.map((item) => item.id))).toStrictEqual(new Set(items.map((item) => item.id)));
  });

  it("does not mutate the input array", () => {
    const original = [...items];
    seededShuffle(items, ["campaign-1", "question-1", "respondent-1"]);
    expect(items).toStrictEqual(original);
  });

  it("varies with the respondent, so a shared answer key does not cover every viewer", () => {
    const orders = ["r1", "r2", "r3", "r4", "r5"].map((respondentId) =>
      seededShuffle(items, ["campaign-1", "question-1", respondentId])
        .map((item) => item.id)
        .join(","),
    );
    expect(new Set(orders).size).toBeGreaterThan(1);
  });

  it("varies with the question, for the same campaign and respondent", () => {
    const orderA = seededShuffle(items, ["campaign-1", "question-a", "respondent-1"]);
    const orderB = seededShuffle(items, ["campaign-1", "question-b", "respondent-1"]);
    expect(orderA).not.toStrictEqual(orderB);
  });

  it("never calls Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    seededShuffle(items, ["campaign-1", "question-1", "respondent-1"]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
