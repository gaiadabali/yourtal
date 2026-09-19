"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../cn";

export const ToastProvider = ToastPrimitive.Provider;

export type ToastViewportProps = React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>;

export const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  ToastViewportProps
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      "fixed bottom-0 right-0 z-50 flex w-full max-w-[calc(100%-2rem)] flex-col gap-2 p-4 sm:max-w-sm",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = "ToastViewport";

export const toastVariants = cva(
  "pointer-events-auto relative flex w-full items-center justify-between gap-3 rounded-lg border p-4 shadow-md",
  {
    variants: {
      variant: {
        default: "border-border bg-surface text-fg",
        success: "border-success bg-surface text-fg",
        danger: "border-danger bg-surface text-fg",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface ToastProps
  extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
    VariantProps<typeof toastVariants> {}

export const Toast = React.forwardRef<React.ComponentRef<typeof ToastPrimitive.Root>, ToastProps>(
  ({ className, variant, ...props }, ref) => (
    <ToastPrimitive.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props} />
  ),
);
Toast.displayName = "Toast";

export type ToastTitleProps = React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>;

export const ToastTitle = React.forwardRef<React.ComponentRef<typeof ToastPrimitive.Title>, ToastTitleProps>(
  ({ className, ...props }, ref) => (
    <ToastPrimitive.Title ref={ref} className={cn("text-sm font-sans font-semibold", className)} {...props} />
  ),
);
ToastTitle.displayName = "ToastTitle";

export type ToastDescriptionProps = React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>;

export const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Description>,
  ToastDescriptionProps
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description ref={ref} className={cn("text-sm text-fg-muted", className)} {...props} />
));
ToastDescription.displayName = "ToastDescription";

export type ToastCloseProps = React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>;

export const ToastClose = React.forwardRef<React.ComponentRef<typeof ToastPrimitive.Close>, ToastCloseProps>(
  ({ className, ...props }, ref) => (
    <ToastPrimitive.Close
      ref={ref}
      className={cn(
        "rounded-md text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <X className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">Dismiss</span>
    </ToastPrimitive.Close>
  ),
);
ToastClose.displayName = "ToastClose";

export type ToastActionProps = React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>;

export const ToastAction = React.forwardRef<React.ComponentRef<typeof ToastPrimitive.Action>, ToastActionProps>(
  ({ className, ...props }, ref) => (
    <ToastPrimitive.Action
      ref={ref}
      className={cn(
        "shrink-0 rounded-md border border-border-strong px-3 py-1.5 text-sm font-sans font-medium text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  ),
);
ToastAction.displayName = "ToastAction";

export type ToastActionElement = React.ReactElement<typeof ToastAction>;
