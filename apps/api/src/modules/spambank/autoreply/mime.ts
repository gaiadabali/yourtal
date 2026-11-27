/**
 * The small part of RFC 5322 / RFC 2045 the auto-reply needs to write its own messages: quoted-printable,
 * wrapped base64, header folding and encoded words. Writing the raw message ourselves (instead of letting
 * JMAP `Email/set` build it) keeps every header the safeguards depend on exactly as tested. No I/O.
 */

const CRLF = "\r\n";
const QP_LINE = 76;

function hex(byte: number): string {
  return `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** RFC 2045 §6.7 quoted-printable of UTF-8 text; line breaks become CRLF, soft breaks keep lines ≤ 76. */
export function quotedPrintable(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines
    .map((line) => {
      const bytes = Buffer.from(line, "utf8");
      const tokens: string[] = [];
      bytes.forEach((byte, index) => {
        const last = index === bytes.length - 1;
        const printable = byte >= 33 && byte <= 126 && byte !== 61;
        const blank = byte === 32 || byte === 9;
        // Trailing white space would be stripped in transit (rule 3), so it is encoded.
        tokens.push(printable || (blank && !last) ? String.fromCharCode(byte) : hex(byte));
      });
      const out: string[] = [];
      let current = "";
      for (const token of tokens) {
        if (current.length + token.length > QP_LINE - 1) {
          out.push(`${current}=`);
          current = "";
        }
        current += token;
      }
      out.push(current);
      return out.join(CRLF);
    })
    .join(CRLF);
}

/** Base64 in 76-character lines. */
export function wrappedBase64(base64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 76) lines.push(base64.slice(i, i + 76));
  return lines.join(CRLF);
}

/** True when the value may go into a header as is: printable ASCII and spaces, no CR or LF. */
export function isPlainHeaderValue(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/**
 * An unstructured header (`Subject`), folded at spaces to lines of at most 78 characters. Non-ASCII text
 * becomes one RFC 2047 encoded word per chunk; CR and LF never survive either way.
 */
export function unstructuredHeader(name: string, value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  if (!isPlainHeaderValue(clean)) {
    const words: string[] = [];
    let chunk = "";
    for (const char of clean) {
      // 45 bytes of UTF-8 make 60 base64 characters: an encoded word stays under 75.
      if (Buffer.byteLength(chunk + char, "utf8") > 45) {
        words.push(chunk);
        chunk = "";
      }
      chunk += char;
    }
    if (chunk !== "") words.push(chunk);
    const encoded = words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`);
    return `${name}: ${encoded.join(`${CRLF} `)}`;
  }
  const words = clean.split(" ");
  const lines: string[] = [];
  let line = `${name}:`;
  for (const word of words) {
    if (line.length + 1 + word.length > 78 && line.length > name.length + 1) {
      lines.push(line);
      line = "";
    }
    line += ` ${word}`;
  }
  lines.push(line);
  return lines.join(CRLF);
}

/** `<id>` tokens, one per folded line after the first. Each id is already checked by `cleanMessageId`. */
export function messageIdListHeader(name: string, ids: readonly string[]): string {
  return `${name}: ${ids.map((id) => `<${id}>`).join(`${CRLF} `)}`;
}

/** A Message-ID as JMAP gives it (no angle brackets), or null if it could smuggle anything into a header. */
export function cleanMessageId(id: string): string | null {
  const trimmed = id.trim().replace(/^<|>$/g, "");
  return trimmed.length > 0 &&
    trimmed.length <= 250 &&
    /^[\x21-\x7e]+$/.test(trimmed) &&
    !/[<>]/.test(trimmed)
    ? trimmed
    : null;
}

/** RFC 5322 date in UTC: `Thu, 27 Nov 2026 01:02:03 +0000`. */
export function rfc5322Date(date: Date): string {
  return date.toUTCString().replace(/ GMT$/, " +0000");
}

/** `name <address>` with the name quoted (it contains parentheses). */
export function mailbox(name: string, address: string): string {
  const quoted = name.replace(/[\\"]/g, "\\$&");
  return `"${quoted}" <${address}>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
