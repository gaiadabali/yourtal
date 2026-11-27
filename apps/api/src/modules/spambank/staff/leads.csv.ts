import type { SpambankLead } from "@yourtal/contracts/spambank/staff";

/** The columns, in the order of the list's item fields (BUILD.md 5.4). */
const COLUMNS = [
  "orgDomain",
  "displayName",
  "sampleFrom",
  "sampleSubject",
  "recipients",
  "messages",
  "firstSeenAt",
  "lastSeenAt",
  "status",
  "note",
  "autoRepliedAt",
  "optedOutAt",
] as const satisfies readonly (keyof SpambankLead)[];

export const LEAD_CSV_HEADER = COLUMNS.join(",");

/**
 * One CSV cell (RFC 4180). A sample From or subject is text a stranger wrote, and a sales person opens
 * this file in a spreadsheet: a cell that starts like a formula gets a leading quote so it stays text.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function leadsToCsv(leads: readonly SpambankLead[]): string {
  const rows = leads.map((lead) => COLUMNS.map((column) => csvCell(lead[column])).join(","));
  return [LEAD_CSV_HEADER, ...rows].join("\r\n") + "\r\n";
}
