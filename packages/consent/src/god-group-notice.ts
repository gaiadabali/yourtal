import { z } from "zod";
import { jurisdictionCodeSchema } from "@yourtal/jurisdiction/jurisdiction-code";
import type { ConsentRecord, ConsentSource } from "./consent-record";
import { GOD_GROUP_NOTICE } from "./god-group-notice-constants";

/**
 * The GOD Group Privacy Notice (god/TASKS.md 9.1). YourTal, SnapApp and Free
 * Tax Returns belong to one group, GOD; nobody's data enters GOD until they
 * (or, for a teen, their guardian) accept this notice. The id, version,
 * decisions and methods below are the shared contract: identical in all
 * three apps, so GOD can read one shape from each.
 *
 * A new version re-asks everyone: a decision recorded against an older
 * version no longer counts, the same "material change" rule
 * `policy-version.ts` applies to the per-purpose consents.
 */
export { GOD_GROUP_NOTICE };

export interface GodGroupNotice {
  readonly id: string;
  readonly version: string;
  readonly effectiveFrom: string;
  readonly url: string;
  readonly teensUrl: string;
}

export const godConsentDecisionSchema = z.enum(["accepted", "declined", "withdrawn"]);
export type GodConsentDecision = z.infer<typeof godConsentDecisionSchema>;

/**
 * How the decision was made. `request` is the withdrawal asked for through
 * the request form (founder, Q4); it is the one value beyond the three the
 * group contract names, and only ever records `withdrawn`.
 */
export const godConsentMethodSchema = z.enum([
  "registration",
  "next_sign_in",
  "guardian",
  "request",
]);
export type GodConsentMethod = z.infer<typeof godConsentMethodSchema>;

/**
 * The sealed teen track (9.7.d) marker: every decision about a 13-17 account
 * carries `teen`, so GOD can route that person into group-only processing
 * without ever reading a date of birth.
 */
export const godConsentTrackSchema = z.enum(["adult", "teen"]);
export type GodConsentTrack = z.infer<typeof godConsentTrackSchema>;

/** One append-only row of `identity.god_group_consent`, or the current one per person. */
export const godConsentRecordSchema = z
  .object({
    userId: z.string().min(1),
    region: jurisdictionCodeSchema,
    noticeId: z.string().min(1),
    noticeVersion: z.string().min(1),
    decision: godConsentDecisionSchema,
    method: godConsentMethodSchema,
    track: godConsentTrackSchema,
    /** Only when a guardian with a YourTal account decided. A YourTal guardian has none (the email link is the credential). */
    guardianUserId: z.string().min(1).nullable(),
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type GodConsentRecord = z.infer<typeof godConsentRecordSchema>;

/**
 * Whether to show an adult the notice box (Accept / Not now) now. Never for a
 * teen: their guardian decides. Asked again only when the version changes,
 * or when the decision on file was a guardian's and the person is now an
 * adult and it is theirs to make.
 */
export function adultShouldBeAsked(
  current: GodConsentRecord | null,
  ageBand: "adult" | "teen",
  notice: GodGroupNotice = GOD_GROUP_NOTICE,
): boolean {
  if (ageBand === "teen") return false;
  if (current === null) return true;
  if (current.noticeVersion !== notice.version) return true;
  return current.track === "teen";
}

/** Whether a teen's guardian still has to decide on the current version. */
export function guardianShouldBeAsked(
  current: GodConsentRecord | null,
  notice: GodGroupNotice = GOD_GROUP_NOTICE,
): boolean {
  return current === null || current.noticeVersion !== notice.version || current.track !== "teen";
}

/**
 * Whether this person's data may enter GOD. Only an acceptance of the current
 * version counts, made on the person's own track; a teen's counts only when
 * their guardian gave it. Everything else (none, declined, withdrawn, stale)
 * keeps them out.
 */
export function isInGod(
  current: GodConsentRecord | null,
  ageBand: "adult" | "teen",
  notice: GodGroupNotice = GOD_GROUP_NOTICE,
): boolean {
  if (current === null || current.decision !== "accepted") return false;
  if (current.noticeVersion !== notice.version || current.track !== ageBand) return false;
  return ageBand === "adult" || current.method === "guardian";
}

/** The `policyVersionId` a GOD decision is recorded against in `ConsentRecord` terms. */
export function godPolicyVersionId(noticeId: string, noticeVersion: string): string {
  return `${noticeId}@${noticeVersion}`;
}

const SOURCE_FOR_METHOD: Readonly<Record<GodConsentMethod, ConsentSource>> = {
  registration: "onboarding",
  next_sign_in: "contextual_prompt",
  guardian: "guardian_consent",
  request: "withdrawal_request",
};

/**
 * A GOD decision as the `god_group_insights` record `mayUseSignalFor` reads.
 * Only `accepted` grants; a decline and a withdrawal both read as withdrawn.
 */
export function toConsentRecord(record: GodConsentRecord): ConsentRecord {
  return {
    userId: record.userId,
    purpose: "god_group_insights",
    jurisdiction: record.region,
    policyVersionId: godPolicyVersionId(record.noticeId, record.noticeVersion),
    state: record.decision === "accepted" ? "granted" : "withdrawn",
    recordedAt: record.recordedAt,
    source: SOURCE_FOR_METHOD[record.method],
  };
}
