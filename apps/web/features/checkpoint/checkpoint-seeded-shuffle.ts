/**
 * Deterministic, seeded shuffle so option order is stable per respondent,
 * per question, per attempt (docs/06-longform-video-and-attention.md
 * section 4.3 — "shuffled option order per user per attempt" is one of the
 * documented anti-answer-sharing defences: a shared "pick C" screenshot
 * becomes useless, but only if the shuffle never changes on re-render for
 * the same person).
 *
 * `packages/contracts/src/internal/seeded-faker.ts` establishes the
 * pattern this follows (stable seed -> deterministic sequence -> never
 * `Math.random()`), but that module is internal to that package (no
 * subpath export) and `@faker-js/faker` is not a runtime dependency of
 * this app. This reimplements the same pattern with two small,
 * dependency-free, platform-independent primitives instead of adding a
 * new dependency for one function: FNV-1a to fold the seed parts into a
 * 32-bit integer, and mulberry32 as the PRNG.
 */

function hashSeedParts(parts: ReadonlyArray<string | number>): number {
  const input = parts.join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a small, fast, deterministic 32-bit PRNG. Same seed -> same output sequence, always. */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a new array with `items` shuffled deterministically from
 * `seedParts` (e.g. `[campaignId, questionId, respondentId]`). The same
 * seed parts always produce the same order; different seed parts (a
 * different question, or a different respondent) produce a different,
 * still-deterministic order. Never mutates `items`.
 */
export function seededShuffle<T>(
  items: readonly T[],
  seedParts: ReadonlyArray<string | number>,
): T[] {
  const random = createSeededRandom(hashSeedParts(seedParts));
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    // `i` and `j` are both valid indices into `result` by construction
    // (0 <= j <= i < result.length), so these reads are never undefined
    // despite noUncheckedIndexedAccess.
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return result;
}
