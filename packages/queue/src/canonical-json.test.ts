import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
  it("is insensitive to key order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("sorts keys recursively, at every nesting level", () => {
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: 1 })).toBe(
      canonicalJson({ a: 1, z: { c: 2, d: 1 } }),
    );
  });

  it("keeps array order — order is meaningful there", () => {
    expect(canonicalJson({ a: [1, 2, 3] })).not.toBe(canonicalJson({ a: [3, 2, 1] }));
  });

  it("still distinguishes genuinely different payloads", () => {
    expect(canonicalJson({ amount: 100 })).not.toBe(canonicalJson({ amount: 200 }));
  });
});
