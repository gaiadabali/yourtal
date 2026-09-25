import * as React from "react";
import { cn } from "../cn";

export interface KeyValueItem {
  key: string;
  label: React.ReactNode;
  value: React.ReactNode;
}

export interface KeyValueProps extends Omit<React.HTMLAttributes<HTMLDListElement>, "children"> {
  items: KeyValueItem[];
  /** inline: label and value share a row. stacked: value sits under the label. */
  layout?: "inline" | "stacked";
}

/** A <dl> of label/value rows, e.g. an order summary or an account detail panel. */
export const KeyValue = React.forwardRef<HTMLDListElement, KeyValueProps>(
  ({ items, layout = "inline", className, ...props }, ref) => (
    <dl ref={ref} className={cn("flex flex-col gap-3", className)} {...props}>
      {items.map((item) => (
        <div
          key={item.key}
          className={cn(
            "flex gap-2",
            layout === "inline" ? "flex-row items-baseline justify-between" : "flex-col",
          )}
        >
          <dt className="text-body-sm font-sans text-fg-muted">{item.label}</dt>
          <dd className="text-body font-sans text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  ),
);
KeyValue.displayName = "KeyValue";
