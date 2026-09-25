import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../cn";

export const cardVariants = cva("rounded-card border border-border-subtle bg-surface", {
  variants: {
    variant: {
      /** A plain container: no interaction, shadow-1 for a slight lift off the canvas. */
      plain: "shadow-1",
      /**
       * The whole card is one target (a stretched link or button covering
       * it) with a hover/focus state. Give the target itself a real
       * accessible name; the card only supplies the visual affordance.
       */
      interactive:
        "relative shadow-1 transition-shadow duration-(--duration-fast) ease-standard hover:shadow-2 " +
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
      /** Sunken content well inside a larger surface — no shadow, no border. */
      inset: "border-transparent bg-surface-sunken shadow-none",
    },
  },
  defaultVariants: { variant: "plain" },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  ),
);
Card.displayName = "Card";

export interface CardTargetProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render the single child (typically a Link) as the stretched target instead of a <button>. */
  asChild?: boolean;
}

/**
 * The stretched target for an `interactive` Card: covers the card's full
 * area so the whole surface is clickable, while remaining a single real
 * link/button in the accessibility tree. Give it the accessible name.
 */
export const CardTarget = React.forwardRef<HTMLButtonElement, CardTargetProps>(
  ({ className, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        className={cn(
          "absolute inset-0 rounded-card focus-visible:outline-none",
          "after:absolute after:inset-0",
          className,
        )}
        {...props}
      />
    );
  },
);
CardTarget.displayName = "CardTarget";

export type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>;

export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 p-4", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level. Defaults to h3 — callers own the outline, this is just the largest text in the card. */
  as?: "h2" | "h3" | "h4";
}

export const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, as: Heading = "h3", ...props }, ref) => (
    <Heading ref={ref} className={cn("text-title font-sans text-fg", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

export type CardDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

export const CardDescription = React.forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-body-sm font-sans text-fg-muted", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

export type CardContentProps = React.HTMLAttributes<HTMLDivElement>;

export const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export type CardFooterProps = React.HTMLAttributes<HTMLDivElement>;

export const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2 p-4 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";
