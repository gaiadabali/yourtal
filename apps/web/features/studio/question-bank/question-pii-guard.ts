/**
 * Detects a checkpoint question that is actually a data-collection vector
 * rather than a comprehension check — docs/06-longform-video-and-attention.md
 * §4.1: "Businesses *will* try to turn the quiz into a lead-capture form;
 * the authoring UI must reject it," restating the explicit banned-category
 * list (phone, email, address, ID number, income, health status) plus the
 * platform's separate rule against harvesting a full name/date of birth for
 * identification. This is a heuristic UI guard, not the moderation gate —
 * docs/06 §4.1 is explicit that banks are "moderated with the video" by a
 * human too; this only stops the obvious cases inline, as the author types,
 * so a business never gets to "in review" believing this was fine.
 *
 * Bilingual (English + Indonesian) because the console serves both AU and
 * ID advertisers (docs/17). Deliberately dependency-free — no Zod, no
 * contract import — so it costs nothing to run on every keystroke of every
 * question's prompt field in a client component.
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
 * TASKS.md 12.3.a: "Teen-rated question banks may not ask personal
 * questions." A stricter, teen-only inline copy of the server's own
 * `detectTeenPersonalQuestion`
 * (`packages/contracts/src/question/question-pii-guard.ts`) -- kept
 * dependency-free for the same reason the rest of this file is, and never
 * the real gate on its own: the server re-runs the identical categories on
 * every save (`create-question.use-case.ts` / `update-question.use-case.ts`),
 * refusing outright for a campaign whose `audience` is `"teen"`. This copy
 * only makes the refusal visible inline, as the author types, the same way
 * `detectPiiRequest`'s own inline warning already works.
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
