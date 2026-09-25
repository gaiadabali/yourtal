"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../cn";

// Tokens v2 look: `default`/`destructive`/`outline` are v1 names kept as
// aliases (below) so callers never need to change; `secondary` and `ghost`
// keep their own names because both sides already agree on them.
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-label font-sans " +
    "transition-colors duration-(--duration-fast) ease-standard disabled:pointer-events-none disabled:opacity-50 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
  {
    variants: {
      variant: {
        primary: "bg-accent text-fg-on-accent hover:bg-accent-hover",
        secondary: "bg-surface-sunken text-fg border border-border-control hover:bg-surface",
        ghost: "bg-transparent text-fg hover:bg-surface-sunken",
        danger: "bg-danger-solid text-fg-on-status hover:opacity-90",
        link: "bg-transparent text-accent underline-offset-4 hover:underline p-0 h-auto",
        // v1 aliases, mapped onto the new look.
        default: "bg-accent text-fg-on-accent hover:bg-accent-hover",
        destructive: "bg-danger-solid text-fg-on-status hover:opacity-90",
        outline: "border border-border-strong bg-transparent text-fg hover:bg-surface-sunken",
      },
      size: {
        md: "h-control px-4",
        sm: "h-control-compact px-3 text-caption",
        lg: "h-12 px-6 text-body",
        counter: "h-control-counter px-8 text-body",
        // v1 aliases.
        default: "h-control px-4",
        icon: "h-control w-control p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

type SharedButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> & {
  /** Render the single child element instead of a <button>, forwarding all props (Radix Slot). */
  asChild?: boolean;
  /** Rendered before the label (or before the icon-only child). Decorative — pass an already aria-hidden icon. */
  leadingIcon?: React.ReactNode;
  /** Rendered after the label. Decorative — pass an already aria-hidden icon. */
  trailingIcon?: React.ReactNode;
  /**
   * Shows a spinner in place of the icons, marks the button aria-busy and
   * disables it, while keeping its rendered width (the label stays in the
   * DOM but hidden, so the button never reflows when loading toggles).
   */
  loading?: boolean;
};

/**
 * Icon-only buttons (size="icon") carry no visible text, so an accessible
 * name must be supplied explicitly. This union makes that a compile error
 * instead of a hope.
 */
export type ButtonProps =
  | (SharedButtonProps & ButtonVariants & { size?: "default" | "md" | "sm" | "lg" | "counter" })
  | (SharedButtonProps &
      ButtonVariants & { size: "icon" } & (
        | { "aria-label": string; "aria-labelledby"?: never }
        | { "aria-labelledby": string; "aria-label"?: never }
      ));

function Spinner() {
  return (
    <svg
      className="size-4 shrink-0 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z"
      />
    </svg>
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild,
      loading,
      leadingIcon,
      trailingIcon,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    // asChild forwards to a single arbitrary child (e.g. a Link), which
    // cannot also host a spinner overlay — loading only applies to a real button.
    const showLoading = loading && !asChild;
    return (
      <Comp
        ref={ref}
        aria-busy={showLoading || undefined}
        disabled={showLoading || disabled}
        className={cn(buttonVariants({ variant, size }), showLoading && "relative", className)}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {showLoading ? (
              <span className="absolute inset-0 flex items-center justify-center">
                <Spinner />
              </span>
            ) : null}
            <span className={cn("inline-flex items-center gap-2", showLoading && "invisible")}>
              {leadingIcon}
              {children}
              {trailingIcon}
            </span>
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
