import { LOCAL_PART_PATTERN } from "@yourtal/contracts/spambank/common";

/**
 * Who may not be called what (spambank/BUILD.md §4.1). A name is `<adjective><animal>`, so the lists
 * are checked on the joined name and on each word.
 */

/** English and Indonesian: refused as a substring of four or more letters. */
const BLOCKED_SUBSTRINGS: readonly string[] = [
  "fuck",
  "shit",
  "cunt",
  "dick",
  "piss",
  "slut",
  "whore",
  "nazi",
  "rape",
  "porn",
  "anal",
  "anus",
  "arse",
  "boob",
  "titt",
  "coon",
  "nigg",
  "fagg",
  "dyke",
  "twat",
  "wank",
  "jizz",
  "kike",
  "gook",
  "paki",
  "kill",
  "dead",
  "bomb",
  "isis",
  "kontol",
  "memek",
  "ngentot",
  "bangsat",
  "jancuk",
  "goblok",
  "anjing",
  "babi",
  "pantek",
  "peler",
  "pepek",
  "toket",
  "bego",
  "tolol",
];

/** Three letters is too short to ban inside other words: refused as a whole word, or across the join. */
const BLOCKED_SHORT: readonly string[] = ["ass", "cum", "fag", "tit", "sex", "kkk", "tai", "gay"];

/** Never issued, however they came about (§4.1). */
const RESERVED: ReadonlySet<string> = new Set([
  "postmaster",
  "abuse",
  "hostmaster",
  "webmaster",
  "admin",
  "root",
  "mailer-daemon",
  "no-reply",
  "noreply",
  "reply",
  "dmarc",
  "support",
  "security",
  "info",
  "hello",
  "billing",
  "privacy",
  "legal",
  "sales",
  "team",
  "staff",
  "ops",
  "statements",
  "yourtal",
  "spambank",
  "snapapp",
  "god",
  "gaia",
]);

/** Why a name is refused, or null when it is fine. */
export type NameProblem = "format" | "reserved" | "blocked";

/**
 * `joinAt` is where the adjective ends, when the name is a generated pair; a 3-letter word then also
 * counts when it straddles the join. Without it only whole-word matches are caught.
 */
export function problemWithName(name: string, joinAt?: number): NameProblem | null {
  if (!LOCAL_PART_PATTERN.test(name)) return "format";
  if (RESERVED.has(name)) return "reserved";
  if (BLOCKED_SUBSTRINGS.some((word) => name.includes(word))) return "blocked";
  for (const word of BLOCKED_SHORT) {
    if (name === word) return "blocked";
    if (joinAt === undefined) continue;
    for (let from = name.indexOf(word); from !== -1; from = name.indexOf(word, from + 1)) {
      if (from < joinAt && from + word.length > joinAt) return "blocked";
    }
  }
  return null;
}

/** A single word: the substring rule, and the short list as a whole word. */
export function wordIsBlocked(word: string): boolean {
  return (
    BLOCKED_SUBSTRINGS.some((blocked) => word.includes(blocked)) || BLOCKED_SHORT.includes(word)
  );
}

export function isReserved(name: string): boolean {
  return RESERVED.has(name);
}
