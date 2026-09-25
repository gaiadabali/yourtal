import { createHmac } from "node:crypto";
import type { RewardAttestation } from "@yourtal/contracts/ledger-internal/rewards";

/**
 * TASKS.md 4.4.c: apps/api's signature on one completed reward session. The
 * ledger pays a campaign reward only on a completion it verifies
 * (`services/ledger/internal/attest`), and computes the points from the terms
 * version named here. The canonical string must match the Go side exactly:
 * versioned, newline-joined, and the completion time in whole-second RFC3339.
 */
export interface RewardCompletion {
  readonly sessionId: string;
  readonly userId: string;
  readonly campaignId: string;
  readonly termsVersion: number;
  readonly completedAt: Date;
  readonly asked: number;
  readonly correct: number;
}

/** `2026-09-26T10:00:00Z`: the form Go's time.RFC3339 prints for a UTC instant. */
export function attestationTime(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function signRewardAttestation(
  secret: string,
  completion: RewardCompletion,
): RewardAttestation {
  const completedAt = attestationTime(completion.completedAt);
  const canonical = [
    "v1",
    completion.sessionId,
    completion.userId,
    completion.campaignId,
    String(completion.termsVersion),
    completedAt,
    String(completion.asked),
    String(completion.correct),
  ].join("\n");
  return {
    sessionId: completion.sessionId,
    termsVersion: completion.termsVersion,
    completedAt,
    asked: completion.asked,
    correct: completion.correct,
    signature: createHmac("sha256", secret).update(canonical).digest("hex"),
  };
}
