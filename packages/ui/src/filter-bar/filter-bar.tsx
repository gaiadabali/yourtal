import * as React from "react";
import { cn } from "../cn";

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Filter controls (chips, selects, toggles) rendered in a row. */
  children: React.ReactNode;
  /** Rendered at the end of the row, e.g. a "Clear filters" button. */
  clearAction?: React.ReactNode;
}

/** A row of filter controls: scrolls horizontally on narrow screens, wraps on desktop. */
export const FilterBar = React.forwardRef<HTMLDivElement, FilterBarProps>(
  ({ children, clearAction, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-2 overflow-x-auto whitespace-nowrap md:flex-wrap md:whitespace-normal",
        className,
      )}
      {...props}
    >
      {children}
      {clearAction ? <div className="shrink-0">{clearAction}</div> : null}
    </div>
  ),
);
FilterBar.displayName = "FilterBar";
