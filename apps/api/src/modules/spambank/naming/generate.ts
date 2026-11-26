import { randomInt } from "node:crypto";
import { ADJECTIVES, ANIMALS } from "./words";
import { problemWithName } from "./blocklist";

/**
 * One generated local part (spambank/BUILD.md §4.1): `<adjective><animal>`, or with `suffix` the same
 * plus a two-digit number 10-99 (the fallback after ten collisions). Pairs the blocklist refuses are
 * drawn again, so the result is always acceptable; whether it is taken is for the database to say.
 */
export type RandomInt = (maxExclusive: number) => number;

const MAX_DRAWS = 50;

export function generateLocalPart(options: { suffix?: boolean; random?: RandomInt } = {}): string {
  const random = options.random ?? ((max: number) => randomInt(max));
  for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
    const adjective = ADJECTIVES[random(ADJECTIVES.length)];
    const animal = ANIMALS[random(ANIMALS.length)];
    if (adjective === undefined || animal === undefined) continue;
    const number = options.suffix === true ? String(10 + random(90)) : "";
    const name = `${adjective}${animal}${number}`;
    // The suffix is digits, so the join sits where the adjective ends either way.
    if (problemWithName(name, adjective.length) === null) return name;
  }
  throw new Error("The name generator could not find an acceptable name.");
}

/** Pairs that are acceptable: the size of the name space. */
export function validCombinations(): number {
  let count = 0;
  for (const adjective of ADJECTIVES) {
    for (const animal of ANIMALS) {
      if (problemWithName(`${adjective}${animal}`, adjective.length) === null) count += 1;
    }
  }
  return count;
}
