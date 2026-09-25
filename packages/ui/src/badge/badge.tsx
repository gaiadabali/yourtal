import * as React from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../cn";

// v1 variant names, kept and remapped onto tokens v2. `reward` is the one
// gold fill in the system (a points amount), always paired with
// text-fg-on-points — see tokens.css's "Gold is a FILL only" rule.
export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-caption font-sans font-medium",
  {
    variants: {
      variant: {
        default: "bg-accent text-fg-on-accent",
        secondary: "bg-surface-sunken text-fg border border-border-subtle",
        success: "bg-success-solid text-fg-on-status",
        warning: "bg-warning-solid text-fg-on-status",
        danger: "bg-danger-solid text-fg-on-status",
        reward: "bg-points text-fg-on-points",
        outline: "border border-border-strong text-fg bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = "Badge";
