"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../cn";

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /**
   * A real, always-rendered <label>. Required — same API shape as Input, so
   * screens moving off a raw <select> keep their existing markup pattern.
   */
  label: string;
  /** Visually hide the label while keeping it in the accessibility tree. */
  hideLabel?: boolean;
  /** Short supporting text rendered under the field and wired via aria-describedby. */
  helpText?: string;
  /** Validation message. Rendered as a live region and marks the field aria-invalid. */
  errorMessage?: string;
}

/**
 * A styled native <select>. Kept native (not Radix Select) on purpose: a
 * plain single-choice list is cheaper on the wire and gets the platform
 * picker for free — see docs/13b §8 and the comment on the raw <select>s
 * this replaces.
 */
export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ label, hideLabel, helpText, errorMessage, id, className, children, ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;
    const helpId = helpText ? `${selectId}-help` : undefined;
    const errorId = errorMessage ? `${selectId}-error` : undefined;
    const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={selectId}
          className={cn("text-label font-sans text-fg", hideLabel && "sr-only")}
        >
          {label}
        </label>
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            aria-describedby={describedBy}
            aria-invalid={errorMessage ? true : undefined}
            className={cn(
              "h-control w-full min-w-0 appearance-none rounded-control border border-border-control bg-surface pl-3 pr-9 text-body font-sans text-fg",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              "disabled:cursor-not-allowed disabled:opacity-50",
              errorMessage && "border-danger-solid",
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden="true"
          />
        </div>
        {helpText ? (
          <p id={helpId} className="text-caption font-sans text-fg-muted">
            {helpText}
          </p>
        ) : null}
        {errorMessage ? (
          <p id={errorId} role="alert" className="text-caption font-sans text-danger-solid">
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  },
);
NativeSelect.displayName = "NativeSelect";
