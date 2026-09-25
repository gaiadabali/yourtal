"use client";

import * as React from "react";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./toast";
import { useToast } from "./use-toast";

/**
 * Renders every toast raised through `toast()`/`useToast()`. Mount once,
 * near the app root — screens then just call `toast({ title, description })`.
 */
export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, variant, duration }) => (
        <Toast
          key={id}
          variant={variant}
          {...(duration === undefined ? {} : { duration })}
          onOpenChange={(open) => {
            if (!open) dismiss(id);
          }}
        >
          <div className="flex flex-col gap-1">
            {title ? <ToastTitle>{title}</ToastTitle> : null}
            {description ? <ToastDescription>{description}</ToastDescription> : null}
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
