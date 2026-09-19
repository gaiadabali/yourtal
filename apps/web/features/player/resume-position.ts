import * as z from "zod/mini";

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
 * Uses `zod/mini` rather than `zod`: identical validation, but the full Zod
 * build ships every locale's error strings and cost ~96 KB gz in this
 * route's client bundle, which broke the 170 KB initial-JS gate (§8).
 */
const RESUME_STORAGE_PREFIX = "yourtal:watch:resume:";

/** Below this many seconds, a "resume" prompt would just be annoying — treat it as no position. */
export const MIN_RESUMABLE_SECONDS = 20;

export const resumePositionSchema = z.object({
  campaignId: z.string().check(z.minLength(1)),
  positionSeconds: z.number().check(z.minimum(0)),
  updatedAt: z.iso.datetime(),
});

export type ResumePosition = z.infer<typeof resumePositionSchema>;

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
    const result = resumePositionSchema.safeParse(parsed);
    return result.success ? result.data : null;
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
