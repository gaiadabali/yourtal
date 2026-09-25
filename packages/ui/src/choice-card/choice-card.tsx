"use client";

import * as React from "react";
import { cn } from "../cn";

export interface ChoiceCardProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "size"
> {
  /** Native semantics backing the card: one-of (radio) or many-of (checkbox). */
  type?: "radio" | "checkbox";
  title: string;
  description?: string;
  /** An image or icon shown above the title. */
  media?: React.ReactNode;
  className?: string;
}

/**
 * A big tappable card whose selection state is a real, visually hidden
 * native input - so keyboard, screen-reader and form behaviour (grouping by
 * `name`, native validation) all come for free instead of being reimplemented.
 */
export const ChoiceCard = React.forwardRef<HTMLInputElement, ChoiceCardProps>(
  ({ type = "radio", title, description, media, className, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const titleId = `${inputId}-title`;
    const descId = description ? `${inputId}-desc` : undefined;

    return (
      <label
        htmlFor={inputId}
        className={cn(
          "group relative flex cursor-pointer flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4",
          "has-[:checked]:border-accent has-[:checked]:bg-accent-subtle",
          "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
          "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
          className,
        )}
      >
        <input
          ref={ref}
          type={type}
          id={inputId}
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="sr-only"
          {...props}
        />
        {media ? <div className="overflow-hidden rounded-control">{media}</div> : null}
        <span className="flex flex-col gap-1">
          <span id={titleId} className="text-title font-sans font-semibold text-fg">
            {title}
          </span>
          {description ? (
            <span id={descId} className="text-body-sm text-fg-muted">
              {description}
            </span>
          ) : null}
        </span>
      </label>
    );
  },
);
ChoiceCard.displayName = "ChoiceCard";
