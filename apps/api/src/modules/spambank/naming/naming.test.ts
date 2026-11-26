import { describe, expect, it } from "vitest";
import { LOCAL_PART_PATTERN } from "@yourtal/contracts/spambank/common";
import { isReserved, problemWithName, wordIsBlocked } from "./blocklist";
import { generateLocalPart, validCombinations } from "./generate";
import { ADJECTIVES, ANIMALS } from "./words";

describe("the word lists", () => {
  it("are the size BUILD.md 4.1 asks for, in 3-8 lower-case letters, with no repeats", () => {
    expect(ADJECTIVES.length).toBeGreaterThanOrEqual(200);
    expect(ANIMALS.length).toBeGreaterThanOrEqual(150);
    for (const word of [...ADJECTIVES, ...ANIMALS]) expect(word).toMatch(/^[a-z]{3,8}$/);
    expect(new Set(ADJECTIVES).size).toBe(ADJECTIVES.length);
    expect(new Set(ANIMALS).size).toBe(ANIMALS.length);
    expect(ADJECTIVES.filter((word) => ANIMALS.includes(word))).toEqual([]);
  });

  it("hold no word the blocklist refuses", () => {
    expect([...ADJECTIVES, ...ANIMALS].filter(wordIsBlocked)).toEqual([]);
  });

  it("leave out the words the brief names as unsuitable", () => {
    const left = [
      "cock",
      "tit",
      "booby",
      "beaver",
      "cougar",
      "ass",
      "shag",
      "raccoon",
      "monkey",
      "dog",
      "pig",
      "hot",
      "sexy",
      "fat",
      "dumb",
      "crazy",
      "drunk",
      "naughty",
      "dirty",
    ];
    expect([...ADJECTIVES, ...ANIMALS].filter((word) => left.includes(word))).toEqual([]);
  });

  it("keep the name space above 30 000 once the blocklist has taken its pairs", () => {
    expect(validCombinations()).toBeGreaterThanOrEqual(30_000);
  });
});

describe("generateLocalPart", () => {
  it("makes 10 000 names that all fit the address rule and none the blocklist refuses", () => {
    for (let n = 0; n < 10_000; n += 1) {
      const name = generateLocalPart();
      expect(name).toMatch(LOCAL_PART_PATTERN);
      expect(name).toMatch(/^[a-z]{6,16}$/);
      expect(problemWithName(name)).toBeNull();
    }
  });

  it("adds a two-digit suffix only when asked", () => {
    for (let n = 0; n < 500; n += 1) {
      const name = generateLocalPart({ suffix: true });
      expect(name).toMatch(LOCAL_PART_PATTERN);
      expect(name).toMatch(/[1-9][0-9]$/);
    }
  });

  it("uses the pair its random source picks", () => {
    const picks = [ADJECTIVES.indexOf("zippy"), ANIMALS.indexOf("duck")];
    let call = 0;
    const name = generateLocalPart({
      random: () => {
        const pick = picks[call % 2] ?? 0;
        call += 1;
        return pick;
      },
    });
    expect(name).toBe("zippyduck");
  });

  it("gives up with an error rather than an unacceptable name", () => {
    expect(() => generateLocalPart({ random: () => -1 })).toThrow(/acceptable name/);
  });
});

describe("problemWithName", () => {
  it("refuses a bad format, reserved names and blocked substrings", () => {
    expect(problemWithName("Geewizduck")).toBe("format");
    expect(problemWithName("short")).toBe("format");
    expect(problemWithName("postmaster")).toBe("reserved");
    expect(problemWithName("statements")).toBe("reserved");
    expect(problemWithName("zippyfuckduck")).toBe("blocked");
    expect(problemWithName("happykontolcat")).toBe("blocked");
    expect(isReserved("noreply")).toBe(true);
  });

  it("refuses a three-letter word only across the join of a generated pair", () => {
    // Inside one word it is just letters: "bassoon" is not the word "ass".
    expect(problemWithName("bassoonwombat")).toBeNull();
    // "...a" + "ss...": the word straddles the adjective/animal boundary.
    expect(problemWithName("lavasstoat", 4)).toBe("blocked");
    expect(problemWithName("lavasstoat", 8)).toBeNull();
  });
});
