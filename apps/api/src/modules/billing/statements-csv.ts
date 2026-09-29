import type { BillingStatement } from "@yourtal/contracts/billing";

const COLUMNS = [
  "id",
  "region",
  "currency",
  "periodFrom",
  "periodTo",
  "openingPayableMinor",
  "capturesMinor",
  "refundsMinor",
  "recoveriesMinor",
  "closingPayableMinor",
  "pointPurchasesPoints",
  "status",
  "disputeWindowEndsAt",
  "generatedAt",
  "payoutTransferId",
] as const;

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const raw = String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** 10.1.b: "exportable as CSV" -- one row per statement, a fixed column order so a business's own spreadsheet import never reshuffles. */
export function statementsToCsv(statements: readonly BillingStatement[]): string {
  const header = COLUMNS.join(",");
  const rows = statements.map((statement) =>
    COLUMNS.map((column) => csvCell(statement[column])).join(","),
  );
  return [header, ...rows].join("\r\n") + "\r\n";
}
