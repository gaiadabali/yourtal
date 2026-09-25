import * as React from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../cn";

export const textVariants = cva("font-sans", {
  variants: {
    size: {
      body: "text-body",
      "body-sm": "text-body-sm",
      label: "text-label font-semibold",
      caption: "text-caption",
    },
    tone: {
      default: "text-fg",
      muted: "text-fg-muted",
      subtle: "text-fg-subtle",
      accent: "text-accent",
      danger: "text-danger-solid",
      success: "text-success-solid",
    },
  },
  defaultVariants: { size: "body", tone: "default" },
});

type TextVariants = VariantProps<typeof textVariants>;

type TextElement = HTMLParagraphElement | HTMLSpanElement | HTMLDivElement | HTMLLabelElement;

export interface TextProps extends Omit<React.HTMLAttributes<TextElement>, "color">, TextVariants {
  /** Element to render. Defaults to <p>. */
  as?: "p" | "span" | "div" | "label";
  /** Tabular numerals and the display face, for amounts and timers. */
  numeric?: boolean;
}

export const Text = React.forwardRef<TextElement, TextProps>(
  ({ as = "p", size, tone, numeric, className, ...props }, ref) => {
    const Tag = as;
    return (
      <Tag
        ref={ref as React.Ref<never>}
        className={cn(textVariants({ size, tone }), numeric && "text-numeric", className)}
        {...props}
      />
    );
  },
);
Text.displayName = "Text";
