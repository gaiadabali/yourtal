import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge doesn't know the tokens v2 type-role scale (text-caption,
 * text-body...) or semantic colour names (text-fg, text-danger-solid...).
 * Unrecognised, both fall back to its generic "text-color" bucket, so e.g.
 * cn("text-caption", "text-danger-solid") silently drops one as a false
 * conflict. Declaring the role names as the font-size scale, and the
 * semantic names as the colour scale (and the new radii and elevations),
 * fixes the classification without
 * changing any conflict that was already resolved correctly.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "display-lg",
        "display",
        "headline",
        "title",
        "body",
        "body-sm",
        "label",
        "caption",
        "numeric",
      ],
      color: [
        "canvas",
        "surface",
        "surface-sunken",
        "overlay",
        "fg",
        "fg-muted",
        "fg-subtle",
        "fg-on-accent",
        "fg-on-points",
        "fg-on-status",
        "accent",
        "accent-hover",
        "accent-subtle",
        "points",
        "points-subtle",
        "focus",
        "success-solid",
        "success-subtle",
        "success-on-subtle",
        "warning-solid",
        "warning-subtle",
        "warning-on-subtle",
        "danger-solid",
        "danger-subtle",
        "danger-on-subtle",
        "info-solid",
        "info-subtle",
        "info-on-subtle",
        "border-subtle",
        "border-control",
        "border-strong",
        // v1 aliases, still used by screens that have not moved over.
        "bg",
        "surface-raised",
        "border",
        "primary",
        "primary-fg",
        "reward",
        "reward-fg",
        "price",
        "price-fg",
        "success",
        "success-fg",
        "warning",
        "warning-fg",
        "danger",
        "danger-fg",
        "ring",
      ],
      radius: ["control", "card", "sheet", "pill"],
      shadow: ["1", "2", "3"],
    },
  },
});

/**
 * Merge conditional class names and resolve conflicting Tailwind utility
 * classes (last one wins), e.g. cn("px-2", condition && "px-4") -> "px-4".
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
