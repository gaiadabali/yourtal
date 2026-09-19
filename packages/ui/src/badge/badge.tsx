import * as React from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-sans font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-fg",
        secondary: "bg-surface-raised text-fg border border-border",
        success: "bg-success text-success-fg",
        warning: "bg-warning text-warning-fg",
        danger: "bg-danger text-danger-fg",
        reward: "bg-reward text-reward-fg",
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
