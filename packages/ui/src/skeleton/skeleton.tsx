import * as React from "react";
import { cn } from "../cn";

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * A loading placeholder. Purely decorative — it carries no information a
 * screen reader user needs, so it is hidden from the accessibility tree by
 * default. Give the surrounding container role="status" / an sr-only
 * "Loading" label if the loading state itself must be announced.
 *
 * Callers set width/height (in rem/%, not fixed px) to match the exact
 * dimensions of the content being loaded, so nothing shifts when it resolves.
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-raised", className)}
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";
