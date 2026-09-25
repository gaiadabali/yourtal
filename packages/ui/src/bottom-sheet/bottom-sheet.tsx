"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../cn";

// Built on the same Radix Dialog primitive as Dialog/Sheet — a bottom sheet
// is a modal, just anchored and shaped differently, so it gets the same
// focus trap and Escape/overlay-close behaviour for free.
export const BottomSheet = DialogPrimitive.Root;
export const BottomSheetTrigger = DialogPrimitive.Trigger;
export const BottomSheetClose = DialogPrimitive.Close;

export type BottomSheetOverlayProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Overlay
>;

export const BottomSheetOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  BottomSheetOverlayProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-(--z-overlay) bg-overlay", className)}
    {...props}
  />
));
BottomSheetOverlay.displayName = "BottomSheetOverlay";

export interface BottomSheetContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Accessible name for the close button. Every caller supplies the translated string. */
  closeLabel: string;
}

/**
 * The sheet panel: pinned to the bottom of the viewport, a drag-handle bar
 * for the affordance (the handle is decorative — Escape and the overlay are
 * the real dismiss paths, since jsdom-testable drag isn't implemented here),
 * rounded-t-sheet, and safe-area padding for devices with a home indicator.
 */
export const BottomSheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  BottomSheetContentProps
>(({ className, children, closeLabel, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <BottomSheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-(--z-overlay) flex max-h-[85vh] flex-col gap-4",
        "rounded-t-sheet border-t border-border-subtle bg-surface p-6 shadow-3",
        "pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      <div
        className="mx-auto -mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-pill bg-border-strong"
        aria-hidden="true"
      />
      {children}
      <DialogPrimitive.Close
        className={cn(
          "absolute right-4 top-4 rounded-control text-fg-muted hover:text-fg",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        )}
      >
        <span aria-hidden="true">&times;</span>
        <span className="sr-only">{closeLabel}</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
BottomSheetContent.displayName = "BottomSheetContent";

export function BottomSheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />;
}

export function BottomSheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-auto flex flex-col gap-2", className)} {...props} />;
}

export type BottomSheetTitleProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;

export const BottomSheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  BottomSheetTitleProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-title font-sans text-fg", className)}
    {...props}
  />
));
BottomSheetTitle.displayName = "BottomSheetTitle";

export type BottomSheetDescriptionProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Description
>;

export const BottomSheetDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  BottomSheetDescriptionProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-body-sm text-fg-muted", className)}
    {...props}
  />
));
BottomSheetDescription.displayName = "BottomSheetDescription";
