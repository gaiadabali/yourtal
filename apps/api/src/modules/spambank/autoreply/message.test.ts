import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOCK_ABN_LINE, formatAbn, isValidAbn } from "./abn";
import {
  BANNER_PNG_BASE64,
  BANNER_PNG_SHA256,
  REPLY_HTML_EN_AU,
  REPLY_TEXT_EN_AU,
} from "./content.generated";
import { buildAlertMessage, buildAutoreplyMessage, splitTextTemplate } from "./message";
import { cleanMessageId, quotedPrintable, unstructuredHeader } from "./mime";
import { canonicalOptoutDomain, optoutLinks, optoutSig, verifyOptoutSig } from "./optout";

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = "o".repeat(43);
const ORIGIN = "https://yourtal.gaiada.com";

/** Undoes quoted-printable, for reading a part back. */
function unQp(encoded: string): string {
  const joined = encoded.replace(/=\r\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    if (joined[i] === "=" && /^[0-9A-F]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n");
}

function build(over: Partial<Parameters<typeof buildAutoreplyMessage>[0]> = {}) {
  return buildAutoreplyMessage({
    id: "0b9d7c2e-1111-4222-8333-944455556666",
    replyDomain: "spambank.yourtal.gaiada.com",
    to: "news@brand.com.au",
    originalMessageIds: ["abc123@mail.brand.com.au"],
    originalReferences: ["older@mail.brand.com.au"],
    optout: optoutLinks(ORIGIN, KEY, "brand.com.au"),
    abnLine: MOCK_ABN_LINE,
    contactEmail: "hello@god.gaiada.com",
    date: new Date("2026-11-28T01:02:03Z"),
    ...over,
  });
}

function headerBlock(raw: string): string {
  return raw.slice(0, raw.indexOf("\r\n\r\n"));
}

function parts(raw: string): { text: string; html: string; png: string } {
  const sections = raw.split(/\r\n--=_sb_[a-z]+_[0-9a-f]+(?:--)?\r\n/);
  const body = (marker: string): string => {
    const found = sections.find((s) => s.includes(marker));
    if (found === undefined) throw new Error(`no part with ${marker}`);
    return found.slice(found.indexOf("\r\n\r\n") + 4);
  };
  return {
    text: unQp(body("Content-Type: text/plain")),
    html: unQp(body("Content-Type: text/html")),
    png: body("Content-Type: image/png").replace(/\r\n/g, ""),
  };
}

describe("the shipped reply content", () => {
  it("is the content/ files, embedded byte for byte", () => {
    expect(REPLY_TEXT_EN_AU).toBe(readFileSync(path.join(here, "content/reply-en-AU.txt"), "utf8"));
    expect(REPLY_HTML_EN_AU).toBe(
      readFileSync(path.join(here, "content/reply-en-AU.html"), "utf8"),
    );
    const png = readFileSync(path.join(here, "content/banner.png"));
    expect(BANNER_PNG_BASE64).toBe(png.toString("base64"));
    expect(BANNER_PNG_SHA256).toBe(createHash("sha256").update(png).digest("hex"));
  });

  it("markets GOD, names the sender, has no price and no remote image", () => {
    expect(REPLY_TEXT_EN_AU).toContain("GOD (Global Omni Data)");
    expect(REPLY_HTML_EN_AU).toContain('src="cid:god-banner"');
    expect(REPLY_HTML_EN_AU).not.toMatch(/src="https?:/i);
    expect(REPLY_HTML_EN_AU).not.toMatch(/url\(/i);
    expect(`${REPLY_TEXT_EN_AU}${REPLY_HTML_EN_AU}`).not.toMatch(/\$\s?\d|A\$|AUD/);
    expect(REPLY_HTML_EN_AU).not.toContain("<!--");
  });
});

describe("buildAutoreplyMessage", () => {
  it("carries every safeguard header", () => {
    const { raw, messageId } = build();
    const head = headerBlock(raw);
    expect(messageId).toBe(
      "autoreply-0b9d7c2e-1111-4222-8333-944455556666@spambank.yourtal.gaiada.com",
    );
    expect(head).toContain('From: "GOD (Global Omni Data)" <reply@spambank.yourtal.gaiada.com>');
    expect(head).toContain("To: <news@brand.com.au>");
    expect(head).toContain(`Message-ID: <${messageId}>`);
    expect(head).toContain("In-Reply-To: <abc123@mail.brand.com.au>");
    expect(head).toContain("References: <older@mail.brand.com.au>\r\n <abc123@mail.brand.com.au>");
    expect(head).toContain("Auto-Submitted: auto-replied");
    expect(head).toContain("X-Auto-Response-Suppress: All");
    const sig = optoutSig(KEY, "brand.com.au");
    expect(head).toContain(`List-Unsubscribe: <${ORIGIN}/api/spambank/optout/brand.com.au/${sig}>`);
    expect(head).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(head).toContain("Date: Sat, 28 Nov 2026 01:02:03 +0000");
    expect(head).not.toContain("X-Spambank-Redirected-From");
    expect(head).toMatch(/Content-Type: multipart\/alternative; boundary="=_sb_alt_[0-9a-f]+"/);
    for (const line of head.split("\r\n")) expect(line).toMatch(/^[\x20-\x7e]*$/);
    for (const line of raw.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
    expect(raw).not.toMatch(/[^\r]\n/);
  });

  it("is text, then related html with the banner inline, filled per recipient domain", () => {
    const { raw, subject } = build();
    expect(subject).toBe(
      "Your email reached a Spambank inbox. Here's a better way to know your customers",
    );
    expect(raw.indexOf("Content-Type: text/plain")).toBeLessThan(
      raw.indexOf("Content-Type: multipart/related"),
    );
    expect(raw).toContain('Content-Type: multipart/related; type="text/html"');
    expect(raw).toContain("Content-ID: <god-banner>");
    expect(raw).toContain('Content-Disposition: inline; filename="god-banner.png"');
    const { text, html, png } = parts(raw);
    const page = `${ORIGIN}/spambank/optout/brand.com.au/${optoutSig(KEY, "brand.com.au")}`;
    expect(text).toContain(`Unsubscribe in one click: ${page}`);
    expect(text).toContain(`ABN: ${MOCK_ABN_LINE}`);
    expect(text).toContain("Contact: hello@god.gaiada.com");
    expect(text).not.toContain("{{");
    expect(html).toContain(`href="${page}"`);
    expect(html).toContain('href="mailto:hello@god.gaiada.com?subject=');
    expect(html).not.toContain("{{");
    expect(png).toBe(BANNER_PNG_BASE64);
    // The only URLs: the opt-out page, mailto links and the inline banner (no tracking, nothing remote).
    const urls = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url === page || url.startsWith("mailto:") || url === "cid:god-banner").toBe(true);
    }
  });

  it("prints a real ABN and a configured contact", () => {
    const { raw } = build({ abnLine: formatAbn("51824753556"), contactEmail: "sales@god.example" });
    const { text, html } = parts(raw);
    expect(text).toContain("ABN: 51 824 753 556");
    expect(text).not.toContain("MOCK");
    expect(html).toContain("mailto:sales@god.example");
  });

  it("in redirect mode, tells the tester who the reply was for", () => {
    const { raw } = build({ to: "tester@gmail.com", redirectedFrom: "news@brand.com.au" });
    expect(headerBlock(raw)).toContain("To: <tester@gmail.com>");
    expect(headerBlock(raw)).toContain("X-Spambank-Redirected-From: <news@brand.com.au>");
  });

  it("drops message ids that could smuggle a header", () => {
    const { raw } = build({
      originalMessageIds: ["evil\r\nBcc: x@y.z"],
      originalReferences: ["a b@c", "<ok@brand.com.au>"],
    });
    const head = headerBlock(raw);
    expect(head).not.toContain("Bcc:");
    expect(head).not.toContain("In-Reply-To");
    expect(head).toContain("References: <ok@brand.com.au>");
    expect(cleanMessageId("<x@y>")).toBe("x@y");
    expect(cleanMessageId("x\n@y")).toBeNull();
  });

  it("builds a plain-text alert", () => {
    const { raw } = buildAlertMessage({
      replyDomain: "spambank.yourtal.gaiada.com",
      to: ["ops@gaiada.com", "web@gaiada.com"],
      subject: "[Spambank] auto-reply paused",
      text: "Reason: 2 complaints",
      id: "id-1",
      date: new Date("2026-11-28T00:00:00Z"),
    });
    expect(raw).toContain("To: <ops@gaiada.com>, <web@gaiada.com>");
    expect(raw).toContain("Auto-Submitted: auto-generated");
    expect(raw).toContain("Reason: 2 complaints");
  });
});

describe("mime helpers", () => {
  it("round-trips quoted-printable with long lines, trailing spaces and UTF-8", () => {
    const text = `${"x".repeat(200)}\ntrailing \n= sign\nnaïve café, ok\n`;
    const encoded = quotedPrintable(text);
    for (const line of encoded.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(encoded).toContain("trailing=20");
    expect(unQp(encoded)).toBe(text);
  });

  it("folds a long subject and encodes a non-ASCII one", () => {
    const folded = unstructuredHeader("Subject", "word ".repeat(40).trim());
    for (const line of folded.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
    expect(unstructuredHeader("Subject", "Halo\r\nBcc: x")).toBe("Subject: Halo Bcc: x");
    expect(unstructuredHeader("Subject", "Promo spesial ✓")).toMatch(/^Subject: =\?UTF-8\?B\?/);
  });

  it("splits the text template into subject and body", () => {
    expect(splitTextTemplate("Subject: Hi\n\nBody\n")).toEqual({ subject: "Hi", body: "Body\n" });
    expect(() => splitTextTemplate("no subject")).toThrow();
  });
});

describe("opt-out signature", () => {
  it("is 22 base64url characters, stable per key and domain", () => {
    const sig = optoutSig(KEY, "brand.com.au");
    expect(sig).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(optoutSig(KEY, "brand.com.au")).toBe(sig);
    expect(optoutSig(KEY, "other.com.au")).not.toBe(sig);
    expect(optoutSig("p".repeat(43), "brand.com.au")).not.toBe(sig);
  });

  it("verifies only the right domain, key and shape", () => {
    const sig = optoutSig(KEY, "brand.com.au");
    expect(verifyOptoutSig(KEY, "brand.com.au", sig)).toBe(true);
    expect(verifyOptoutSig(KEY, "brand.com", sig)).toBe(false);
    const flipped = `${sig.slice(0, 21)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(verifyOptoutSig(KEY, "brand.com.au", flipped)).toBe(false);
    expect(verifyOptoutSig(KEY, "brand.com.au", `${sig}x`)).toBe(false);
    expect(canonicalOptoutDomain("Brand.COM.au")).toBe("brand.com.au");
    expect(canonicalOptoutDomain("brand.com.au/../x")).toBeNull();
    expect(canonicalOptoutDomain("localhost")).toBeNull();
  });
});

describe("ABN", () => {
  it("checks the ATO checksum and refuses the mock", () => {
    expect(isValidAbn("51 824 753 556")).toBe(true);
    expect(isValidAbn("51824753557")).toBe(false);
    expect(isValidAbn("00 000 000 000")).toBe(false);
    expect(isValidAbn("1234")).toBe(false);
    expect(formatAbn("51824753556")).toBe("51 824 753 556");
  });
});
