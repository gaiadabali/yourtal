"use client";

import * as React from "react";
import { cn } from "../cn";

export interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "children" | "type"
> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Always rendered, next to the control. Required — this is the accessible name. */
  label: string;
  /** Visually hide the label while keeping it in the accessibility tree. */
  hideLabel?: boolean;
}

/**
 * A native <button role="switch">, built without a dependency: no Radix
 * switch is in package.json. The hit area is a full 44 px square regardless
 * of surface (a hard accessibility floor); the visual track is smaller and
 * centred inside it.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked,
      defaultChecked,
      onCheckedChange,
      label,
      hideLabel,
      className,
      disabled,
      onClick,
      ...props
    },
    ref,
  ) => {
    const [uncontrolled, setUncontrolled] = React.useState(defaultChecked ?? false);
    const isControlled = checked !== undefined;
    const isOn = isControlled ? checked : uncontrolled;
    const labelId = React.useId();

    const toggle = () => {
      if (disabled) return;
      const next = !isOn;
      if (!isControlled) setUncontrolled(next);
      onCheckedChange?.(next);
    };

    return (
      <span className={cn("inline-flex items-center gap-2", disabled && "opacity-50")}>
        <button
          ref={ref}
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-labelledby={labelId}
          disabled={disabled}
          onClick={(event) => {
            onClick?.(event);
            toggle();
          }}
          className={cn(
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            "disabled:cursor-not-allowed",
            className,
          )}
          {...props}
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex h-5 w-9 items-center rounded-pill border border-border-control p-0.5 transition-colors duration-base ease-standard",
              isOn ? "bg-accent" : "bg-surface-sunken",
            )}
          >
            <span
              className={cn(
                "h-4 w-4 rounded-full bg-canvas shadow-1 transition-transform duration-base ease-standard",
                isOn && "translate-x-4",
              )}
            />
          </span>
        </button>
        <span
          id={labelId}
          onClick={disabled ? undefined : toggle}
          className={cn(
            "text-body-sm font-sans text-fg",
            !disabled && "cursor-pointer",
            hideLabel && "sr-only",
          )}
        >
          {label}
        </span>
      </span>
    );
  },
);
Switch.displayName = "Switch";
