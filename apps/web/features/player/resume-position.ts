/**
 * Persists watch position to localStorage so a resume prompt can be offered
 * on a later visit. Per docs/13b-typescript-standards.md §3: "anything out
 * of localStorage gets Zod-parsed before use" — localStorage is a process
 * boundary (another tab, a stale schema version, or a tampered value can
 * all write there) and every read/write is wrapped in try/catch, since
 * private-browsing mode throws on access in some engines and quota can be
 * exceeded at any time. A corrupt or missing entry must never break
 * playback — every function here degrades to "no prior position" instead
 * of throwing.
 *
 * Validated by a hand-written guard, not Zod (13.4.d, F94): even
 * `zod/mini` puts zod core in this route's first load and kept the watch
 * pages over the 200 KB initial-JS gate (§8). The checks are the same ones
 * the schema made: every field present, typed, and in range.
 */
const RESUME_STORAGE_PREFIX = "yourtal:watch:resume:";

/** Below this many seconds, a "resume" prompt would just be annoying — treat it as no position. */
export const MIN_RESUMABLE_SECONDS = 20;

export interface ResumePosition {
  campaignId: string;
  positionSeconds: number;
  updatedAt: string;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** The stored value as a `ResumePosition`, or null. Unknown keys are dropped. */
export function parseResumePosition(value: unknown): ResumePosition | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v["campaignId"] !== "string" || v["campaignId"].length === 0) return null;
  const position = v["positionSeconds"];
  if (typeof position !== "number" || !Number.isFinite(position) || position < 0) return null;
  const updatedAt = v["updatedAt"];
  if (typeof updatedAt !== "string" || !ISO_DATETIME.test(updatedAt)) return null;
  if (Number.isNaN(Date.parse(updatedAt))) return null;
  return { campaignId: v["campaignId"], positionSeconds: position, updatedAt };
}

function storageKey(campaignId: string): string {
  return `${RESUME_STORAGE_PREFIX}${campaignId}`;
}

/** Reads a prior watch position for this campaign, or null if there is none or it fails to validate. */
export function readResumePosition(campaignId: string): ResumePosition | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(storageKey(campaignId));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return parseResumePosition(parsed);
  } catch {
    return null;
  }
}

/** Best-effort write. Resume is a nicety, not a requirement — a failure here is silently ignored. */
export function writeResumePosition(position: ResumePosition): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey(position.campaignId), JSON.stringify(position));
  } catch {
    // Private mode, quota exceeded, or storage disabled.
  }
}

export function clearResumePosition(campaignId: string): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(storageKey(campaignId));
  } catch {
    // Same as writeResumePosition.
  }
}
