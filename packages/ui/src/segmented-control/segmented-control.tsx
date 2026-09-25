"use client";

import * as React from "react";
import { cn } from "../cn";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name for the group — there is no visible fallback. */
  label: string;
  /** 2-5 options. Any more and this stops being "segmented". */
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

type SegmentedControlComponent = <T extends string>(
  props: SegmentedControlProps<T> & { ref?: React.Ref<HTMLDivElement> },
) => React.ReactElement;

/**
 * A radiogroup, not a tab list: it picks one value, it doesn't navigate.
 * Follows the WAI-ARIA APG radio-group pattern - arrow keys both move focus
 * and change the selection; Home/End jump to the ends.
 */
const SegmentedControlImpl = React.forwardRef(function SegmentedControl<T extends string>(
  { label, options, value, onChange, className }: SegmentedControlProps<T>,
  ref: React.Ref<HTMLDivElement>,
) {
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const selectAt = (index: number) => {
    const count = options.length;
    const nextIndex = ((index % count) + count) % count;
    const option = options[nextIndex];
    if (!option) return;
    onChange(option.value);
    itemRefs.current[nextIndex]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        selectAt(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        selectAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        selectAt(0);
        break;
      case "End":
        event.preventDefault();
        selectAt(options.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex gap-1 rounded-control bg-surface-sunken p-1", className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              handleKeyDown(event, index);
            }}
            className={cn(
              "h-control-compact flex-1 rounded-control px-3 text-label font-sans transition-colors duration-fast ease-standard",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              selected ? "bg-surface text-fg shadow-1" : "text-fg-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
});
(SegmentedControlImpl as { displayName?: string }).displayName = "SegmentedControl";

export const SegmentedControl = SegmentedControlImpl as SegmentedControlComponent;
