import { hasQuoteInComment, stripComments } from "./header-values";
import { normalizeDomain, splitAddress } from "./org-domain";

/** One `method=result prop=value …` clause of an Authentication-Results field. */
export interface AuthResultEntry {
  /** Lower-case, without a `/version` suffix. */
  readonly method: string;
  /** Lower-case. */
  readonly result: string;
  /** Lower-case keys (`header.from`, `smtp.mailfrom`, `reason`); values unquoted. */
  readonly props: ReadonlyMap<string, string>;
}

export interface AuthResultsField {
  readonly authservId: string;
  readonly results: readonly AuthResultEntry[];
}

export type AuthResultsParse =
  | { readonly ok: true; readonly field: AuthResultsField }
  | { readonly ok: false; readonly error: "malformed" | "unsupported_version" };

const KEYWORD = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const PROP_KEY = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/;

class Cursor {
  pos = 0;
  constructor(readonly s: string) {}
  atEnd(): boolean {
    return this.pos >= this.s.length;
  }
  peek(): string {
    return this.s.charAt(this.pos);
  }
  skipWs(): void {
    while (!this.atEnd() && /\s/.test(this.peek())) this.pos++;
  }
  /**
   * A token or quoted string, or both run together (`"a b"@x.com`), up to
   * whitespace or `;` — and up to `=` when reading a key. Values may hold
   * `=` (base64 `header.b=`). Quoted strings are unescaped. Null if empty.
   */
  word(stopAtEquals: boolean): string | null {
    let text = "";
    let any = false;
    while (!this.atEnd()) {
      const ch = this.peek();
      if (/\s/.test(ch) || ch === ";" || (stopAtEquals && ch === "=")) break;
      any = true;
      this.pos++;
      if (ch !== '"') {
        text += ch;
        continue;
      }
      while (!this.atEnd() && this.peek() !== '"') {
        if (this.peek() === "\\") this.pos++;
        text += this.peek();
        this.pos++;
      }
      this.pos++; // closing quote; stripComments already proved it exists
    }
    return any ? text : null;
  }
  eat(ch: string): boolean {
    if (this.peek() !== ch) return false;
    this.pos++;
    return true;
  }
}

/** The authserv-id alone, read leniently, to decide whether a field is ours. */
export function authservIdOf(raw: string): string | null {
  const stripped = stripComments(raw);
  if (stripped === null) {
    // Broken comments later in the field must not hide whose field it is.
    const m = /^\s*(?:\([^()]*\)\s*)*([^\s;=("]+)/.exec(raw);
    return m?.[1]?.toLowerCase() ?? null;
  }
  const c = new Cursor(stripped);
  c.skipWs();
  const id = c.word(true);
  return id === null ? null : id.toLowerCase();
}

/**
 * Strict RFC 8601 parse. Anything outside the grammar makes the whole field
 * `malformed`: values such as `smtp.mailfrom` and SPF comments carry
 * sender-controlled text, and a field whose clause structure is in doubt must
 * never be read as a pass.
 */
export function parseAuthenticationResults(raw: string): AuthResultsParse {
  const malformed = { ok: false, error: "malformed" } as const;
  const stripped = stripComments(raw);
  if (stripped === null || hasQuoteInComment(raw)) return malformed;
  const c = new Cursor(stripped);
  c.skipWs();
  const authservId = c.word(true);
  if (authservId === null || authservId === "") return malformed;
  c.skipWs();
  if (!c.atEnd() && c.peek() !== ";") {
    const version = c.word(true);
    if (version === null || !/^[0-9]+$/.test(version)) return malformed;
    if (Number(version) !== 1) return { ok: false, error: "unsupported_version" };
    c.skipWs();
  }
  if (c.atEnd()) return malformed; // neither "; none" nor a result

  const results: AuthResultEntry[] = [];
  let sawNone = false;
  while (!c.atEnd()) {
    if (!c.eat(";")) return malformed;
    c.skipWs();
    if (c.atEnd() || c.peek() === ";") continue; // empty clause
    const methodWord = c.word(true);
    if (methodWord === null) return malformed;
    c.skipWs();
    if (methodWord.toLowerCase() === "none" && (c.atEnd() || c.peek() === ";")) {
      sawNone = true;
      continue;
    }
    const entry = parseResinfo(c, methodWord);
    if (entry === null) return malformed;
    results.push(entry);
  }
  if (sawNone && results.length > 0) return malformed;
  return { ok: true, field: { authservId: authservId.toLowerCase(), results } };
}

function parseResinfo(c: Cursor, methodWord: string): AuthResultEntry | null {
  const [method, version, ...rest] = methodWord.toLowerCase().split("/");
  if (method === undefined || !KEYWORD.test(method) || rest.length > 0) return null;
  if (version !== undefined && !/^[0-9]+$/.test(version)) return null;
  if (!c.eat("=")) return null;
  c.skipWs();
  const result = c.word(true)?.toLowerCase();
  if (result === undefined || !KEYWORD.test(result)) return null;
  const props = new Map<string, string>();
  for (;;) {
    c.skipWs();
    if (c.atEnd() || c.peek() === ";") break;
    const key = c.word(true)?.toLowerCase();
    if (key === undefined || !PROP_KEY.test(key)) return null;
    c.skipWs();
    if (!c.eat("=")) return null;
    c.skipWs();
    const value = c.word(false);
    if (value === null) return null;
    // A repeated property is ambiguous: refuse rather than pick one.
    if (props.has(key)) return null;
    props.set(key, value);
  }
  return { method, result, props };
}

/** JMAP `EmailAddress`. */
export interface AddressInput {
  readonly name?: string | null | undefined;
  readonly email?: string | null | undefined;
}

export interface SenderAuthInput {
  /** `header:Authentication-Results:asText:all`, topmost first. */
  readonly authenticationResults: readonly string[];
  /** JMAP `from`. */
  readonly from: readonly AddressInput[] | null;
  /** Number of From header fields, when known (`header:From:asAddresses:all`). */
  readonly fromHeaderCount?: number | undefined;
  /** `SPAMBANK_AUTHSERV_ID`. */
  readonly authservId: string;
}

export type SenderAuthFailure =
  | "no_authserv_id"
  | "no_from"
  | "multiple_from"
  | "bad_from"
  | "no_trusted_field"
  | "malformed_field"
  | "unsupported_version"
  | "no_dmarc"
  | "multiple_dmarc"
  | "dmarc_not_pass"
  | "header_from_mismatch";

export type SenderAuthResult =
  | { readonly ok: true; readonly fromDomain: string }
  | { readonly ok: false; readonly code: "unauthenticated"; readonly detail: SenderAuthFailure };

/**
 * BUILD.md §4.6 check 2. Reads only the topmost Authentication-Results field
 * whose authserv-id is ours; every other field — including lower ones that
 * claim our id — is ignored. It must hold exactly one `dmarc` clause, `pass`,
 * with `header.from` equal to the From domain. Exactly one, because a second
 * clause can only come from injected text or an ambiguous message.
 */
export function checkSenderAuth(input: SenderAuthInput): SenderAuthResult {
  const fail = (detail: SenderAuthFailure): SenderAuthResult => ({
    ok: false,
    code: "unauthenticated",
    detail,
  });
  const ourId = input.authservId.trim().toLowerCase();
  if (ourId === "") return fail("no_authserv_id");

  const from = input.from ?? [];
  if (from.length === 0) return fail("no_from");
  if (from.length > 1 || (input.fromHeaderCount ?? 1) > 1) return fail("multiple_from");
  const addr = splitAddress(from[0]?.email ?? "");
  if (addr === null) return fail("bad_from");

  const ours = input.authenticationResults.find((raw) => authservIdOf(raw) === ourId);
  if (ours === undefined) return fail("no_trusted_field");
  const parsed = parseAuthenticationResults(ours);
  if (!parsed.ok) {
    return fail(parsed.error === "unsupported_version" ? "unsupported_version" : "malformed_field");
  }

  const dmarc = parsed.field.results.filter((r) => r.method === "dmarc");
  if (dmarc.length === 0) return fail("no_dmarc");
  if (dmarc.length > 1) return fail("multiple_dmarc");
  const only = dmarc[0];
  if (only?.result !== "pass") return fail("dmarc_not_pass");
  const headerFrom = only.props.get("header.from");
  if (headerFrom === undefined || normalizeDomain(headerFrom) !== addr.domain) {
    return fail("header_from_mismatch");
  }
  return { ok: true, fromDomain: addr.domain };
}
