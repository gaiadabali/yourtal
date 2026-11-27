import type { Addr } from "@yourtal/mail-engine";

/** The two display locales; dates and sizes follow the person's own language. */
export type MailLocale = "en-AU" | "id-ID";

export function mailLocale(locale: string): MailLocale {
  return locale === "id-ID" ? "id-ID" : "en-AU";
}

/** The name if there is one, else the address; `fallback` for a message with no sender. */
export function senderLabel(addr: Addr | null | undefined, fallback: string): string {
  if (!addr) return fallback;
  return addr.name?.trim() || addr.email;
}

/** "Maria Santos <maria@example.com>" for the reader. */
export function fullAddress(addr: Addr): string {
  return addr.name?.trim() ? `${addr.name.trim()} <${addr.email}>` : addr.email;
}

export function initialsOf(addr: Addr | null | undefined): string {
  const source = addr?.name?.trim() || addr?.email || "?";
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0], words[1]] : [words[0] ?? "?"])
    .map((w) => (w ?? "").charAt(0))
    .join("");
  return letters.toUpperCase().slice(0, 2) || "?";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Today: the time. This year: "20 Nov". Earlier: "20 Nov 2025". In the viewer's own time zone.
 * Only called from client-rendered lists, so there is no server/browser mismatch to hydrate.
 */
export function listDate(iso: string, locale: MailLocale, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  }
  if (
    d.getFullYear() === now.getFullYear() &&
    Math.abs(now.getTime() - d.getTime()) < 300 * DAY_MS
  ) {
    return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** "Fri, 20 Nov 2026, 3:15 pm" */
export function fullDate(iso: string, locale: MailLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "20 Nov 2026" */
export function dayDate(iso: string | null, locale: MailLocale): string {
  if (iso === null) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

export function fileSize(bytes: number, locale: MailLocale): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const n = (value: number, digits: number) =>
    value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  if (bytes < 1000) return `${n(bytes, 0)} B`;
  if (bytes < 1_000_000) return `${n(Math.round(bytes / 1000), 0)} KB`;
  if (bytes < 1_000_000_000) {
    return `${n(bytes / 1_000_000, bytes < 10_000_000 ? 1 : 0)} MB`;
  }
  return `${n(bytes / 1_000_000_000, 1)} GB`;
}

export function countLabel(n: number): string {
  return n > 99 ? "99+" : String(n);
}
