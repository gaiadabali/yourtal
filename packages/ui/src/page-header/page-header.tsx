import * as React from "react";
import { Heading } from "../heading/heading";
import { Text } from "../text/text";
import { cn } from "../cn";

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  /** Heading level for the title. Defaults to 1 — a page header names the page. */
  level?: 1 | 2 | 3;
  /** A back link/button, rendered above the title. */
  back?: React.ReactNode;
  /** Buttons or menus for the page, e.g. primary actions. */
  actions?: React.ReactNode;
}

/** Page-level heading block: back link, title + description, and actions. Stacks under the title on mobile. */
export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ title, description, level = 1, back, actions, className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-3", className)} {...props}>
      {back ? <div>{back}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <Heading level={level} size="headline">
            {title}
          </Heading>
          {description ? <Text tone="muted">{description}</Text> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  ),
);
PageHeader.displayName = "PageHeader";
