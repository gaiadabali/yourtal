import * as React from "react";
import { cn } from "../cn";

export interface DataTableColumn<Row> {
  key: string;
  header: React.ReactNode;
  cell: (row: Row, rowIndex: number) => React.ReactNode;
  align?: "start" | "end" | "center";
}

export interface DataTableProps<Row> extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  /** Required: describes what the table shows, read by screen readers, never visible copy alone. */
  caption: string;
  /** Stable identity for a row, used as the React key. Falls back to row index. */
  getRowKey?: (row: Row, rowIndex: number) => React.Key;
}

const alignClass: Record<"start" | "end" | "center", string> = {
  start: "text-start",
  end: "text-end",
  center: "text-center",
};

/**
 * A real <table> from `md` up, and a stacked card per row below it — both
 * rendered, one hidden with `hidden`/`md:hidden` so exactly one reaches the
 * accessibility tree (display:none removes an element from it) at a time.
 */
export function DataTable<Row>({
  columns,
  rows,
  caption,
  getRowKey,
  className,
  ...props
}: DataTableProps<Row>) {
  const rowKey = getRowKey ?? ((_row: Row, index: number) => index);

  return (
    <div className={cn("w-full", className)} {...props}>
      <table className="hidden w-full border-collapse text-body-sm font-sans md:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border-subtle">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-3 py-2 font-semibold text-fg-muted",
                  alignClass[column.align ?? "start"],
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowKey(row, rowIndex)} className="border-b border-border-subtle last:border-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn("px-3 py-2 text-fg", alignClass[column.align ?? "start"])}
                >
                  {column.cell(row, rowIndex)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="flex flex-col gap-3 md:hidden" aria-label={caption}>
        {rows.map((row, rowIndex) => (
          <li
            key={rowKey(row, rowIndex)}
            className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4"
          >
            {columns.map((column) => (
              <div key={column.key} className="flex items-baseline justify-between gap-3">
                <span className="text-caption text-fg-muted">{column.header}</span>
                <span className="text-body-sm text-fg">{column.cell(row, rowIndex)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
