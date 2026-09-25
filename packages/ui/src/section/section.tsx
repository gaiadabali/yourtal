import * as React from "react";
import { Heading } from "../heading/heading";
import { Text } from "../text/text";
import { cn } from "../cn";

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  title: string;
  description?: string;
  /** Heading level for the section title. Defaults to 2. */
  level?: 2 | 3 | 4 | 5 | 6;
  /** A button or link for the section, e.g. "See all". */
  action?: React.ReactNode;
}

/** A titled <section>, wired to its heading via aria-labelledby so it names itself to assistive tech. */
export const Section = React.forwardRef<HTMLElement, SectionProps>(
  ({ title, description, level = 2, action, className, children, ...props }, ref) => {
    const headingId = React.useId();
    return (
      <section
        ref={ref}
        aria-labelledby={headingId}
        className={cn("flex flex-col gap-4", className)}
        {...props}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <Heading id={headingId} level={level} size="title">
              {title}
            </Heading>
            {description ? <Text tone="muted">{description}</Text> : null}
          </div>
          {action ? <div>{action}</div> : null}
        </div>
        {children}
      </section>
    );
  },
);
Section.displayName = "Section";
