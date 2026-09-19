"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-sans font-medium " +
    "transition-colors disabled:pointer-events-none disabled:opacity-50 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-fg hover:bg-primary/90",
        secondary: "bg-surface-raised text-fg border border-border hover:bg-surface-raised/80",
        outline: "border border-border-strong bg-transparent text-fg hover:bg-surface-raised",
        ghost: "bg-transparent text-fg hover:bg-surface-raised",
        destructive: "bg-danger text-danger-fg hover:bg-danger/90",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-6 text-base",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

type SharedButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> & {
  /** Render the single child element instead of a <button>, forwarding all props (Radix Slot). */
  asChild?: boolean;
};

/**
 * Icon-only buttons (size="icon") carry no visible text, so an accessible
 * name must be supplied explicitly. This union makes that a compile error
 * instead of a hope.
 */
export type ButtonProps =
  | (SharedButtonProps & ButtonVariants & { size?: "default" | "sm" | "lg" })
  | (SharedButtonProps &
      ButtonVariants & { size: "icon" } & (
        | { "aria-label": string; "aria-labelledby"?: never }
        | { "aria-labelledby": string; "aria-label"?: never }
      ));

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";
