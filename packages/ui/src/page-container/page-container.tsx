import * as React from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../cn";

export const pageContainerVariants = cva(
  "mx-auto w-full px-gutter-sm md:px-gutter-md lg:px-gutter-lg",
  {
    variants: {
      width: {
        narrow: "max-w-page-narrow",
        default: "max-w-page",
        wide: "max-w-page-wide",
      },
    },
    defaultVariants: { width: "default" },
  },
);

export interface PageContainerProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof pageContainerVariants> {}

/** Centers page content and applies the responsive gutter + max-width for its width tier. */
export const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  ({ width, className, ...props }, ref) => (
    <div ref={ref} className={cn(pageContainerVariants({ width }), className)} {...props} />
  ),
);
PageContainer.displayName = "PageContainer";
