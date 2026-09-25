import * as React from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../cn";

export const statusBadgeVariants = cva(
  "inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-caption font-sans font-medium",
  {
    variants: {
      status: {
        success: "",
        warning: "",
        danger: "",
        info: "",
        neutral: "",
      },
      emphasis: {
        subtle: "",
        solid: "",
      },
    },
    compoundVariants: [
      { status: "success", emphasis: "subtle", class: "bg-success-subtle text-success-on-subtle" },
      { status: "success", emphasis: "solid", class: "bg-success-solid text-fg-on-status" },
      { status: "warning", emphasis: "subtle", class: "bg-warning-subtle text-warning-on-subtle" },
      { status: "warning", emphasis: "solid", class: "bg-warning-solid text-fg-on-status" },
      { status: "danger", emphasis: "subtle", class: "bg-danger-subtle text-danger-on-subtle" },
      { status: "danger", emphasis: "solid", class: "bg-danger-solid text-fg-on-status" },
      { status: "info", emphasis: "subtle", class: "bg-info-subtle text-info-on-subtle" },
      { status: "info", emphasis: "solid", class: "bg-info-solid text-fg-on-status" },
      { status: "neutral", emphasis: "subtle", class: "bg-surface-sunken text-fg-muted" },
      {
        status: "neutral",
        emphasis: "solid",
        class: "bg-fg-muted text-fg-on-status",
      },
    ],
    defaultVariants: { status: "neutral", emphasis: "subtle" },
  },
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof statusBadgeVariants> {}

/**
 * A status pill (success/warning/danger/info/neutral), in two emphases:
 * `subtle` for a list row, `solid` for a standalone callout. No visible
 * copy of its own — pass the label as children, translated by the caller.
 */
export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, status, emphasis, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(statusBadgeVariants({ status, emphasis }), className)}
      {...props}
    />
  ),
);
StatusBadge.displayName = "StatusBadge";
