"use client";

import * as React from "react";
import { cn } from "../cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * A real, always-rendered <label>. Required — a placeholder is never an
   * acceptable substitute for an accessible name.
   */
  label: string;
  /** Visually hide the label while keeping it in the accessibility tree. */
  hideLabel?: boolean;
  /** Short supporting text rendered under the field and wired via aria-describedby. */
  helpText?: string;
  /** Validation message. Rendered as a live region and marks the field aria-invalid. */
  errorMessage?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, hideLabel, helpText, errorMessage, id, className, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const helpId = helpText ? `${inputId}-help` : undefined;
    const errorId = errorMessage ? `${inputId}-error` : undefined;
    const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className={cn("text-sm font-sans font-medium text-fg", hideLabel && "sr-only")}
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={errorMessage ? true : undefined}
          className={cn(
            "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm font-sans text-fg",
            "placeholder:text-fg-subtle",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            errorMessage && "border-danger",
            className,
          )}
          {...props}
        />
        {helpText ? (
          <p id={helpId} className="text-xs font-sans text-fg-muted">
            {helpText}
          </p>
        ) : null}
        {errorMessage ? (
          <p id={errorId} role="alert" className="text-xs font-sans text-danger">
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";
