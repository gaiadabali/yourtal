import * as React from "react";
import { Heading } from "../heading/heading";
import { Text } from "../text/text";
import { cn } from "../cn";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/** A centred placeholder for a list or panel with nothing in it yet. */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-surface p-8 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div aria-hidden="true" className="text-fg-subtle">
          {icon}
        </div>
      ) : null}
      <Heading level={3} size="title">
        {title}
      </Heading>
      {description ? <Text tone="muted">{description}</Text> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";
