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
