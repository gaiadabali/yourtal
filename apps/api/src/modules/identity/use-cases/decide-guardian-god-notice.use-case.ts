import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { DecideGuardianGodNoticeResult } from "@yourtal/contracts/identity/guardian";
import { hashOpaqueToken } from "../../auth/crypto/opaque-token";
import {
  guardianConsentStatusOf,
  type GuardianConsentRepository,
} from "../persistence/guardian-consent.repository";
import type { GodConsentRepository } from "../persistence/god-consent.repository";
import type { DecideGuardianGodNoticeError } from "../guardian-consent.errors";

/**
 * `POST /api/guardian/:token/god-notice` (god/TASKS.md 9.1.c): the guardian
 * of an already-approved teen accepts the GOD Group Privacy Notice for teens,
 * or says not now. Either way the teen keeps using the app; only `accepted`
 * puts them in GOD, on the sealed teen track. A pending link decides this on
 * approval instead, and a revoked one cannot decide anything.
 */
export async function decideGuardianGodNotice(
  consents: Pick<GuardianConsentRepository, "findByTokenHash">,
  god: Pick<GodConsentRepository, "append">,
  rawToken: string,
  decision: "accepted" | "declined",
  now: Date,
): Promise<Result<DecideGuardianGodNoticeResult, DecideGuardianGodNoticeError>> {
  const row = await consents.findByTokenHash(hashOpaqueToken(rawToken));
  if (row === null) return err({ type: "not_found" });
  if (guardianConsentStatusOf(row) !== "granted") return err({ type: "not_granted" });

  await god.append(
    { userId: row.userId, region: row.region, decision, method: "guardian", track: "teen" },
    now,
  );
  return ok({ decision });
}
