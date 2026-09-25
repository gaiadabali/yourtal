"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../cn";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export type SheetOverlayProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>;

export const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  SheetOverlayProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-(--z-overlay) bg-overlay", className)}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

export const sheetVariants = cva(
  "fixed z-(--z-overlay) flex flex-col gap-4 border-border-subtle bg-surface p-6 shadow-3 focus-visible:outline-none",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b rounded-b-card w-full max-h-[80vh]",
        bottom: "inset-x-0 bottom-0 border-t rounded-t-card w-full max-h-[80vh]",
        left: "inset-y-0 left-0 h-full w-[calc(100%-3rem)] max-w-sm border-r",
        right: "inset-y-0 right-0 h-full w-[calc(100%-3rem)] max-w-sm border-l",
      },
    },
    defaultVariants: { side: "right" },
  },
);

export interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Accessible name for the close button. Optional, defaults to "Close" for existing callers. */
  closeLabel?: string;
}

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side, className, children, closeLabel = "Close", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          "absolute right-4 top-4 rounded-control text-fg-muted hover:text-fg",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        )}
      >
        <X className="size-4" aria-hidden="true" />
        <span className="sr-only">{closeLabel}</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-auto flex justify-end gap-2", className)} {...props} />;
}

export type SheetTitleProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;

export const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  SheetTitleProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-title font-sans text-fg", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

export type SheetDescriptionProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Description
>;

export const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  SheetDescriptionProps
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-body-sm text-fg-muted", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";
