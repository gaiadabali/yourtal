/**
 * Detects a checkpoint question that is actually a data-collection vector
 * rather than a comprehension check — docs/06-longform-video-and-attention.md
 * §4.1: "Businesses *will* try to turn the quiz into a lead-capture form;
 * the authoring UI must reject it," restating the explicit banned-category
 * list (phone, email, address, ID number, income, health status) plus the
 * platform's separate rule against harvesting a full name/date of birth for
 * identification.
 *
 * TASKS.md 7.3.b: "the PII guard moves to the server" — this is that move.
 * The identical heuristic used to live client-side only
 * (`apps/web/features/console/question-bank/question-pii-guard.ts`, YT-0505),
 * which meant a business could bypass it entirely by calling the API
 * directly. This copy is the one a save actually enforces against
 * (`studio`'s question-bank use-cases); the client-side copy stays useful
 * as inline-as-you-type feedback (7.8's own concern) but is no longer where
 * the real gate lives.
 *
 * Bilingual (English + Indonesian) because Studio serves both AU and ID
 * advertisers (docs/17). Deliberately dependency-free — no Zod — so it
 * costs nothing to run on every question saved.
 */
export interface PiiFinding {
  /** The banned category this prompt appears to be requesting. */
  category: string;
  /** The specific term that matched, surfaced in the inline message so the author can see exactly what tripped it. */
  matchedTerm: string;
  /** The reason shown inline, per this ticket's acceptance criterion ("with the reason"). */
  reason: string;
}

interface PiiRule {
  category: string;
  reason: string;
  pattern: RegExp;
}

const PII_RULES: PiiRule[] = [
  {
    category: "phone number",
    reason:
      "Questions cannot ask for a phone number. A checkpoint checks what someone remembers from the video, not their contact details.",
    pattern:
      /\b(phone|mobile|whatsapp|wa)\s*(number|no\.?)?\b|nomor\s*(telepon|hp|wa|whatsapp)|no\.?\s*(hp|wa)\b/i,
  },
  {
    category: "email address",
    reason:
      "Questions cannot ask for an email address — that is lead capture, not a comprehension check.",
    pattern: /\bemail\b|\balamat\s*email\b|\be-?mail\b/i,
  },
  {
    category: "home address",
    reason:
      "Questions cannot ask where someone lives. That is a data-collection request, not something the video taught.",
    pattern: /\b(home\s+)?address\b|alamat\s*(rumah|lengkap|domisili)|\bkode\s*pos\b|\bpostcode\b/i,
  },
  {
    category: "government ID number",
    reason:
      "Questions cannot ask for a national ID, tax or passport number. This is identity harvesting, which the platform never allows through a reward gate.",
    pattern:
      /\b(nik|ktp|kartu\s*keluarga|kk)\b|\bpassport\b|\bnpwp\b|\bid\s*number\b|\bnomor\s*(ktp|induk)\b/i,
  },
  {
    category: "income",
    reason:
      "Questions cannot ask about income or salary. That is financial profiling, not video comprehension.",
    pattern: /\bincome\b|\bsalary\b|\bgaji\b|\bpenghasilan\b/i,
  },
  {
    category: "health status",
    reason:
      "Questions cannot ask about health conditions. Health data needs its own explicit, separately-consented flow.",
    pattern:
      /\bhealth\s*(condition|status)s?\b|\bkondisi\s*kesehatan\b|\bpenyakit\b|\bmedical\s*history\b/i,
  },
  {
    category: "bank or card details",
    reason:
      "Questions cannot ask for a bank account or card number. Payment details are never collected through a quiz.",
    pattern: /\bbank\s*account\b|\brekening\b|\bcredit\s*card\b|\bkartu\s*kredit\b|\bcvv\b/i,
  },
  {
    category: "full name for identification",
    reason:
      "Questions cannot ask for someone's full legal name. If you need to identify a respondent, that happens through their account, not the quiz.",
    pattern: /\b(full|legal)\s*name\b|\bnama\s*lengkap\b/i,
  },
];

/**
 * Scans one question prompt for a PII/lead-capture request. Returns the
 * first match (rules are checked in the order above, which is also
 * roughly severity order) or `null` if the prompt looks like an ordinary
 * comprehension/opinion question.
 */
export function detectPiiRequest(promptText: string): PiiFinding | null {
  const trimmed = promptText.trim();
  if (trimmed.length === 0) {
    return null;
  }
  for (const rule of PII_RULES) {
    const match = rule.pattern.exec(trimmed);
    if (match) {
      return { category: rule.category, matchedTerm: match[0], reason: rule.reason };
    }
  }
  return null;
}

/**
 * Red line 1: no prediction or guessing questions. The question type union
 * (`question.ts`) already has no "prediction" variant, so this is the other
 * half — moderation flagging on the PROMPT TEXT itself, in case an author
 * phrases a forbidden prediction inside an otherwise-ordinary question type
 * ("Will the price go up next month?" fits `true_false` perfectly).
 */
export interface PredictionFinding {
  readonly matchedTerm: string;
  readonly reason: string;
}

const PREDICTION_PATTERN =
  /\bwill\s+\w+|\bpredict(s|ed|ing)?\b|\bguess(es|ed|ing)?\b|\bakan\s+\w+|\bmenebak\b|\btebak(an)?\b|\bramal(kan)?\b/i;

export function detectPredictionRequest(promptText: string): PredictionFinding | null {
  const trimmed = promptText.trim();
  if (trimmed.length === 0) return null;
  const match = PREDICTION_PATTERN.exec(trimmed);
  if (match === null) return null;
  return {
    matchedTerm: match[0],
    reason:
      "Questions cannot ask someone to predict or guess an outcome (red line 1). A checkpoint checks what the video showed, not what might happen next.",
  };
}

/**
 * TASKS.md 12.3.a: "Teen-rated question banks may not ask personal
 * questions." A STRICTER layer on top of `detectPiiRequest` above -- that
 * function already refuses hard data-harvesting categories (phone, email,
 * government ID, and the rest) for every campaign, regardless of audience.
 * This one adds the categories that are ordinary, fine questions for an
 * adult audience (an opinion on age, school, neighbourhood, appearance,
 * family or an online handle) but are not something a 13-17-year-old's quiz
 * should be asking at all -- the platform minimising what it collects from
 * a minor, not just what counts as identity-theft-grade PII. Called when
 * the campaign's own `audience` is `"teen"` OR `"all_ages"`
 * (`create-question.use-case.ts` / `update-question.use-case.ts`) -- a teen
 * account reaches all_ages campaigns too (12.4.c, F83; see
 * `packages/contracts/src/audience/audience.ts`'s `reachesAudience`). An
 * adult or parents campaign, which a teen can never reach, never runs this
 * check.
 */
const TEEN_PERSONAL_RULES: PiiRule[] = [
  {
    category: "age or date of birth",
    reason:
      "Teen-rated question banks cannot ask someone's age or date of birth. This platform already knows a viewer's age band; a quiz never needs to ask again.",
    pattern:
      /\bhow\s+old\s+are\s+you\b|\byour\s+age\b|\bdate\s+of\s+birth\b|\bberapa\s+umur\b|\busia\s*(kamu|anda)\b|\btanggal\s*lahir\b/i,
  },
  {
    category: "school",
    reason:
      "Teen-rated question banks cannot ask what school someone goes to. That identifies a minor's physical location, which this platform never collects through a quiz.",
    pattern: /\bwhat\s+school\b|\bwhich\s+school\b|\bsekolah\s*(mana|kamu|anda)\b/i,
  },
  {
    category: "where you live",
    reason:
      "Teen-rated question banks cannot ask what city or suburb someone lives in. A comprehension check never needs to know where a minor is.",
    pattern:
      /\bwhat\s+(city|suburb|neighbo(u)?rhood)\s+do\s+you\s+live\b|\bkota\s*(mana|apa)\s*(kamu|anda)?\s*tinggal\b|\btinggal\s*di\s*mana\b/i,
  },
  {
    category: "appearance",
    reason:
      "Teen-rated question banks cannot ask about someone's physical appearance. That is personal profiling, not video comprehension.",
    pattern:
      /\bwhat\s+do\s+you\s+look\s+like\b|\byour\s+(weight|height)\b|\bberat\s*badan\s*(kamu|anda)\b|\btinggi\s*badan\s*(kamu|anda)\b/i,
  },
  {
    category: "family",
    reason:
      "Teen-rated question banks cannot ask about someone's parents or siblings. Family details are never something a checkpoint needs.",
    pattern:
      /\byour\s+(parents|mother|father|siblings|brother|sister)\b|\borang\s*tua\s*(kamu|anda)\b|\bsaudara\s*(kamu|anda)\b/i,
  },
  {
    category: "social media handle",
    reason:
      "Teen-rated question banks cannot ask for a social media username or handle. That is contact-collection, not a comprehension check.",
    pattern:
      /\b(instagram|tiktok|snapchat|discord)\s*(username|handle|account)?\b|\bakun\s*(instagram|tiktok|snapchat|discord)\b/i,
  },
  {
    category: "relationship status",
    reason:
      "Teen-rated question banks cannot ask about someone's relationship or dating status. That is personal profiling of a minor, which this platform never collects.",
    pattern: /\b(girlfriend|boyfriend|dating\s+anyone)\b|\bpunya\s*pacar\b|\bstatus\s*pacaran\b/i,
  },
];

/**
 * Scans one teen-campaign question prompt for a personal-question request
 * beyond the universal PII list. Returns `null` for an ordinary
 * comprehension/opinion question -- the same "how likely are you to
 * recommend this" style prompt `detectPiiRequest` already lets through.
 */
export function detectTeenPersonalQuestion(promptText: string): PiiFinding | null {
  const trimmed = promptText.trim();
  if (trimmed.length === 0) {
    return null;
  }
  for (const rule of TEEN_PERSONAL_RULES) {
    const match = rule.pattern.exec(trimmed);
    if (match) {
      return { category: rule.category, matchedTerm: match[0], reason: rule.reason };
    }
  }
  return null;
}
