"use client";

import * as React from "react";
import { cn } from "../cn";

const CHIP_BASE =
  "inline-flex h-control-compact items-center gap-1.5 rounded-pill px-3 text-label font-sans whitespace-nowrap transition-colors duration-fast ease-standard";

export interface FilterChipProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  variant?: "filter";
  /** Whether this chip is currently selected. */
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

export interface StaticChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant: "static";
}

/** A selectable filter chip (toggle button, aria-pressed) or a static tag (span). */
export type ChipProps = FilterChipProps | StaticChipProps;

function isStatic(props: ChipProps): props is StaticChipProps {
  return props.variant === "static";
}

export const Chip = React.forwardRef<HTMLButtonElement | HTMLSpanElement, ChipProps>(
  (props, ref) => {
    if (isStatic(props)) {
      const { variant: _variant, className, ...rest } = props;
      return (
        <span
          ref={ref}
          className={cn(CHIP_BASE, "bg-surface-sunken text-fg-muted", className)}
          {...rest}
        />
      );
    }

    const { variant: _variant, pressed, onPressedChange, className, disabled, ...rest } = props;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        aria-pressed={pressed}
        disabled={disabled}
        onClick={() => onPressedChange(!pressed)}
        className={cn(
          CHIP_BASE,
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          "disabled:cursor-not-allowed disabled:opacity-50",
          pressed
            ? "bg-accent text-fg-on-accent"
            : "bg-surface-sunken text-fg hover:bg-surface-sunken/70",
          className,
        )}
        {...rest}
      />
    );
  },
);
Chip.displayName = "Chip";
