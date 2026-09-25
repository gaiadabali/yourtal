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
      "fixed bottom-0 right-0 z-(--z-toast) flex w-full max-w-[calc(100%-2rem)] flex-col gap-2 p-4 sm:max-w-sm",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = "ToastViewport";

export const toastVariants = cva(
  "pointer-events-auto relative flex w-full items-center justify-between gap-3 rounded-card border p-4 shadow-3",
  {
    variants: {
      variant: {
        default: "border-border-subtle bg-surface text-fg",
        success: "border-success-solid bg-surface text-fg",
        danger: "border-danger-solid bg-surface text-fg",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface ToastProps
  extends
    React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
    VariantProps<typeof toastVariants> {}

export const Toast = React.forwardRef<React.ComponentRef<typeof ToastPrimitive.Root>, ToastProps>(
  ({ className, variant, ...props }, ref) => (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  ),
);
Toast.displayName = "Toast";

export type ToastTitleProps = React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>;

export const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Title>,
  ToastTitleProps
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-label font-sans text-fg", className)}
    {...props}
  />
));
ToastTitle.displayName = "ToastTitle";

export type ToastDescriptionProps = React.ComponentPropsWithoutRef<
  typeof ToastPrimitive.Description
>;

export const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Description>,
  ToastDescriptionProps
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-body-sm text-fg-muted", className)}
    {...props}
  />
));
ToastDescription.displayName = "ToastDescription";

export type ToastCloseProps = React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>;

export const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Close>,
  ToastCloseProps
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      "rounded-control text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      className,
    )}
    {...props}
  >
    <X className="size-4" aria-hidden="true" />
    <span className="sr-only">Dismiss</span>
  </ToastPrimitive.Close>
));
ToastClose.displayName = "ToastClose";

export type ToastActionProps = React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>;

export const ToastAction = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Action>,
  ToastActionProps
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      "shrink-0 rounded-control border border-border-strong px-3 py-1.5 text-body-sm font-sans font-medium text-fg",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = "ToastAction";

export type ToastActionElement = React.ReactElement<typeof ToastAction>;
