"use client";

import * as React from "react";
import { cn } from "../cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * A real, always-rendered <label>. Required — a placeholder is never an
   * acceptable substitute for an accessible name. Same API shape as Input.
   */
  label: string;
  /** Visually hide the label while keeping it in the accessibility tree. */
  hideLabel?: boolean;
  /** Short supporting text rendered under the field and wired via aria-describedby. */
  helpText?: string;
  /** Validation message. Rendered as a live region and marks the field aria-invalid. */
  errorMessage?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hideLabel, helpText, errorMessage, id, className, rows = 4, ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = id ?? generatedId;
    const helpId = helpText ? `${textareaId}-help` : undefined;
    const errorId = errorMessage ? `${textareaId}-error` : undefined;
    const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={textareaId}
          className={cn("text-label font-sans text-fg", hideLabel && "sr-only")}
        >
          {label}
        </label>
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={errorMessage ? true : undefined}
          className={cn(
            "w-full min-w-0 resize-y rounded-control border border-border-control bg-surface px-3 py-2 text-body font-sans text-fg",
            "placeholder:text-fg-subtle",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            "disabled:cursor-not-allowed disabled:opacity-50",
            errorMessage && "border-danger-solid",
            className,
          )}
          {...props}
        />
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
Textarea.displayName = "Textarea";
