import * as React from "react";
import { cn } from "../cn";

export interface QRPanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** A data URL (or any <img> src) for the QR image. Omit and pass `children` for a custom
   * renderer, e.g. an inline <svg> - no QR dependency lives in this package. */
  src?: string;
  /** Required - describes what scanning the code does, for a screen-reader user. */
  alt: string;
  children?: React.ReactNode;
  /** The human-typeable fallback for the code, shown under the image. */
  code: string;
  caption?: string;
}

/**
 * The QR image sits on a literal white panel, not a themed surface - a
 * quiet zone needs to stay light-on-dark for scanners regardless of the
 * app's theme, so `bg-white` here is a physical requirement, not a style
 * choice (the founder-approved reference panel used the same fixed white).
 */
export const QRPanel = React.forwardRef<HTMLDivElement, QRPanelProps>(
  ({ src, alt, children, code, caption, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-surface p-5",
        className,
      )}
      {...props}
    >
      <div className="rounded-control bg-white p-3">
        {src ? (
          <img src={src} alt={alt} className="size-44" />
        ) : (
          <div role="img" aria-label={alt} className="flex size-44 items-center justify-center">
            {children}
          </div>
        )}
      </div>
      <span className="font-mono text-body font-semibold tracking-widest text-fg">{code}</span>
      {caption ? <span className="text-body-sm text-fg-muted text-center">{caption}</span> : null}
    </div>
  ),
);
QRPanel.displayName = "QRPanel";
