"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "../cn";

export interface ProgressProps extends Omit<
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>,
  "aria-label"
> {
  /** Current value out of `max` (default 100). */
  value: number;
  max?: number;
  /** Required — a progress bar with no accessible name tells a screen-reader user nothing. */
  "aria-label": string;
}

export const Progress = React.forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, max = 100, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    value={value}
    max={max}
    className={cn("relative h-2 w-full overflow-hidden rounded-pill bg-surface-sunken", className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-accent transition-transform duration-(--duration-slow) ease-standard"
      style={{ transform: `translateX(-${100 - (Math.min(value, max) / max) * 100}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = "Progress";
