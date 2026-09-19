import { hashStringToSeed } from "@yourtal/contracts/mock-seed";

/**
 * `@yourtal/contracts/business/member`'s `BusinessMember` carries only a
 * bare `userId` — there is no profile contract reachable from the console
 * yet, and inventing one is exactly the kind of schema decision this
 * ticket is told to leave to the architect. Rather than render raw UUIDs
 * in a team roster (unusable) or silently invent a `displayName` field on
 * `BusinessMember` (which `docs/13b-typescript-standards.md`'s "do not
 * invent fields" rule and the task brief both forbid), this is a
 * console-local, display-only lookup: real for the fixed demo cast this
 * console's mock fixtures use, and a deterministic (never random)
 * fallback for any other id, so a member outside the fixed cast still
 * renders a stable, plausible name instead of a UUID or "undefined".
 */
export interface MemberProfile {
  name: string;
  email: string;
}

const KNOWN_MEMBERS: Record<string, MemberProfile> = {
  "00000000-0000-4000-8000-000000000701": {
    name: "Dewi Marketer",
    email: "dewi@kopikenangan.example",
  },
  "00000000-0000-4000-8000-000000000710": {
    name: "Budi Santoso",
    email: "budi@kopikenangan.example",
  },
  "00000000-0000-4000-8000-000000000711": {
    name: "Citra Wulandari",
    email: "citra@kopikenangan.example",
  },
  "00000000-0000-4000-8000-000000000712": {
    name: "Eka Pratama",
    email: "eka@kopikenangan.example",
  },
  "00000000-0000-4000-8000-000000000713": {
    name: "Fajar Nugroho",
    email: "fajar@kopikenangan.example",
  },
  "00000000-0000-4000-8000-000000000714": {
    name: "Gita Ramadhani",
    email: "gita@kopikenangan.example",
  },
};

const FALLBACK_FIRST_NAMES = [
  "Alex",
  "Sam",
  "Jordan",
  "Taylor",
  "Morgan",
  "Casey",
  "Riley",
  "Wina",
] as const;

/**
 * Looks up a member's display profile. Falls back to a name deterministically
 * derived from the id (never `Math.random()`) so the same id always renders
 * the same name across a session and across test runs.
 */
export function getMemberProfile(userId: string): MemberProfile {
  const known = KNOWN_MEMBERS[userId];
  if (known) {
    return known;
  }
  const seed = hashStringToSeed(userId);
  const firstName = FALLBACK_FIRST_NAMES[seed % FALLBACK_FIRST_NAMES.length] ?? "Member";
  const shortId = userId.slice(0, 8);
  return { name: `${firstName} (${shortId})`, email: `${shortId}@example.invalid` };
}
