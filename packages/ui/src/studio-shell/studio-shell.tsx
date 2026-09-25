import * as React from "react";
import { cn } from "../cn";

export interface StudioShellProps {
  /**
   * The navigation itself — real links, built with `next/link` by the
   * caller. Rendered once inside a container that switches from a
   * horizontal, scrollable strip below `lg` to a fixed 240px sidebar at
   * `lg` and up: the caller's markup does not need to know which.
   */
  nav: React.ReactNode;
  /** A page-level header row (title, actions). Optional — some studio pages need none. */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * The business/staff console shell (task 3.5.c). `data-surface="studio"`
 * ties every control under this tree to the dense, desaturated 36px studio
 * tokens (`packages/ui/src/styles/tokens.css`). Layout only, no `next/*`
 * import: `apps/web` supplies `nav`/`header` as slots built with its own
 * router primitives, so this component (and its test) never needs a Next
 * router context to render.
 */
export const StudioShell = React.forwardRef<HTMLDivElement, StudioShellProps>(
  ({ nav, header, children, className }, ref) => {
    return (
      <div
        ref={ref}
        data-surface="studio"
        className={cn("flex min-h-dvh flex-col bg-canvas text-fg lg:flex-row", className)}
      >
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle bg-surface px-3 py-2",
            "lg:h-dvh lg:w-60 lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-3",
          )}
        >
          {nav}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {header ? (
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface px-4">
              {header}
            </div>
          ) : null}
          <main className="min-w-0 flex-1 overflow-auto p-4">{children}</main>
        </div>
      </div>
    );
  },
);
StudioShell.displayName = "StudioShell";
