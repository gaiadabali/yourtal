import { describe, expect, it } from "vitest";
import { attestationTime, signRewardAttestation } from "./reward-attestation";

describe("signRewardAttestation (4.4.c)", () => {
  it("matches the ledger's canonical string: the vector attest_test.go asserts", () => {
    const attestation = signRewardAttestation("test-only-reward-attestation-secret-32", {
      sessionId: "s1",
      userId: "u1",
      campaignId: "c1",
      termsVersion: 2,
      completedAt: new Date("2026-09-26T10:00:00.456Z"),
      asked: 3,
      correct: 2,
    });
    expect(attestation.completedAt).toBe("2026-09-26T10:00:00Z");
    expect(attestation.signature).toBe(
      "6a7e21138773bb39109cdfb82c83d629c9a7bc14c8dfdd652e26bda936b9903a",
    );
  });

  it("drops milliseconds, as Go's RFC3339 does", () => {
    expect(attestationTime(new Date("2026-01-02T03:04:05.999Z"))).toBe("2026-01-02T03:04:05Z");
  });
});
