import * as React from "react";
import { cn } from "../cn";

const SIZES = {
  sm: "size-7 text-caption",
  md: "size-10 text-label",
  lg: "size-14 text-title",
} as const;

// Every entry pairs a fill with the text token that stays readable on it.
const PALETTE = [
  { bg: "bg-accent", fg: "text-fg-on-accent" },
  { bg: "bg-success-solid", fg: "text-fg-on-status" },
  { bg: "bg-warning-solid", fg: "text-fg-on-status" },
  { bg: "bg-danger-solid", fg: "text-fg-on-status" },
  { bg: "bg-info-solid", fg: "text-fg-on-status" },
] as const;

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Same name, same colour, every time - so a channel is recognisable at a glance. */
function paletteFor(name: string): (typeof PALETTE)[number] {
  return PALETTE[hashName(name) % PALETTE.length] ?? PALETTE[0];
}

function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  const [first, second] = words;
  return `${first?.[0] ?? ""}${second?.[0] ?? ""}`.toUpperCase();
}

export interface ChannelAvatarProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "children"
> {
  /** The channel's display name. Also the accessible name, image alt or fallback source. */
  name: string;
  src?: string;
  /** Override the derived initials, e.g. for a channel with a short-name convention. */
  initials?: string;
  size?: "sm" | "md" | "lg";
}

export const ChannelAvatar = React.forwardRef<HTMLSpanElement, ChannelAvatarProps>(
  ({ name, src, initials, size = "md", className, ...props }, ref) => {
    const [failed, setFailed] = React.useState(false);
    const showImage = Boolean(src) && !failed;
    const { bg, fg } = paletteFor(name);
    const label = (initials ?? deriveInitials(name)).toUpperCase();

    return (
      <span
        ref={ref}
        role={showImage ? undefined : "img"}
        aria-label={showImage ? undefined : name}
        className={cn(
          "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-bold",
          SIZES[size],
          !showImage && bg,
          !showImage && fg,
          className,
        )}
        {...props}
      >
        {showImage ? (
          <img
            src={src}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => {
              setFailed(true);
            }}
          />
        ) : (
          <span aria-hidden="true">{label}</span>
        )}
      </span>
    );
  },
);
ChannelAvatar.displayName = "ChannelAvatar";
