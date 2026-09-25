import * as React from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../cn";

/**
 * Visual size is independent of heading level: a section can be an <h2> that
 * reads small, or an <h3> that reads big, so document outline and type scale
 * don't have to move together.
 */
export const headingVariants = cva("font-sans text-fg", {
  variants: {
    size: {
      "display-lg": "font-display text-display-lg",
      display: "font-display text-display",
      headline: "font-display text-headline",
      title: "font-sans text-title font-semibold",
    },
  },
  defaultVariants: { size: "title" },
});

type HeadingVariants = VariantProps<typeof headingVariants>;

export interface HeadingProps
  extends Omit<React.HTMLAttributes<HTMLHeadingElement>, "color">, HeadingVariants {
  /** Document outline level, h1-h6. Chosen for structure, not for size. */
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ level, size, className, ...props }, ref) => {
    const Tag = `h${level}` as const;
    return <Tag ref={ref} className={cn(headingVariants({ size }), className)} {...props} />;
  },
);
Heading.displayName = "Heading";
