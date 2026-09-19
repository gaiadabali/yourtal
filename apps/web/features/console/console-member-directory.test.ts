import { describe, expect, it } from "vitest";
import { getMemberProfile } from "./console-member-directory";

describe("getMemberProfile", () => {
  it("returns the known profile for a fixture member id", () => {
    expect(getMemberProfile("00000000-0000-4000-8000-000000000710")).toEqual({
      name: "Budi Santoso",
      email: "budi@kopikenangan.example",
    });
  });

  it("deterministically derives a fallback profile for an unknown id, never a raw UUID", () => {
    const unknownId = "11111111-2222-4333-8444-555555555555";
    const first = getMemberProfile(unknownId);
    const second = getMemberProfile(unknownId);
    expect(first).toEqual(second);
    expect(first.name).not.toContain(unknownId);
  });

  it("gives two different unknown ids different fallback names", () => {
    const a = getMemberProfile("11111111-1111-4111-8111-111111111111");
    const b = getMemberProfile("22222222-2222-4222-8222-222222222222");
    expect(a.name).not.toEqual(b.name);
  });
});
