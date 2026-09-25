import * as React from "react";
import { cn } from "../cn";

export interface CounterShellProps {
  /** A big, glanceable header — business name, redemption status. */
  header: React.ReactNode;
  /** A small set of actions for the shared device (e.g. Scan / History). Optional. */
  nav?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * The merchant counter shell (task 3.5.c) for a shared, fixed device at the
 * point of redemption. `data-surface="counter"` ties every control under
 * this tree to the maximum-contrast, 56px-target counter tokens
 * (`packages/ui/src/styles/tokens.css`) — everything here is sized for a
 * quick glance and a thumb, not a mouse. Layout only, no `next/*` import,
 * same reasoning as `studio-shell.tsx`.
 */
export const CounterShell = React.forwardRef<HTMLDivElement, CounterShellProps>(
  ({ header, nav, children, className }, ref) => {
    return (
      <div
        ref={ref}
        data-surface="counter"
        className={cn("flex min-h-dvh flex-col bg-canvas text-fg", className)}
      >
        <header className="flex min-h-24 shrink-0 items-center gap-4 border-b border-border-subtle bg-surface px-6 text-headline font-sans font-semibold">
          {header}
        </header>
        {nav ? (
          <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
            {nav}
          </div>
        ) : null}
        <main className="flex min-w-0 flex-1 flex-col gap-4 p-6">{children}</main>
      </div>
    );
  },
);
CounterShell.displayName = "CounterShell";
