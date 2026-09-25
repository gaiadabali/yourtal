import * as React from "react";
import { Heading } from "../heading/heading";
import { Text } from "../text/text";
import { cn } from "../cn";

export interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Rendered after the description, typically a retry button. */
  retry?: React.ReactNode;
}

/** Like EmptyState, but for a failure: announced immediately via role="alert". */
export const ErrorState = React.forwardRef<HTMLDivElement, ErrorStateProps>(
  ({ icon, title, description, retry, className, ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-surface p-8 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div aria-hidden="true" className="text-danger-solid">
          {icon}
        </div>
      ) : null}
      <Heading level={3} size="title">
        {title}
      </Heading>
      {description ? <Text tone="muted">{description}</Text> : null}
      {retry ? <div className="mt-1">{retry}</div> : null}
    </div>
  ),
);
ErrorState.displayName = "ErrorState";
