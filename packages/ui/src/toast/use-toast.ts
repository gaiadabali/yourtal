"use client";

import * as React from "react";
import type { ToastActionElement, ToastProps } from "./toast";

export interface ToastMessage {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
  variant?: ToastProps["variant"];
  /** Milliseconds before Radix auto-dismisses. Omit for the provider default. */
  duration?: number;
}

export type ToastInput = Omit<ToastMessage, "id">;

type Listener = (toasts: ToastMessage[]) => void;

// Module-level store, not React context: `useToast()` needs to work from any
// component under a single <Toaster/>, including outside any provider tree
// a screen happens to render (e.g. a hook called from an event handler).
let memoryState: ToastMessage[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(memoryState);
}

let nextId = 0;
function genId(): string {
  nextId += 1;
  return `toast-${nextId}`;
}

/** Raise a toast from anywhere; render <Toaster/> once, near the app root, to display it. */
export function toast(input: ToastInput): { id: string; dismiss: () => void } {
  const id = genId();
  memoryState = [...memoryState, { ...input, id }];
  emit();
  return { id, dismiss: () => dismissToast(id) };
}

export function dismissToast(id: string): void {
  memoryState = memoryState.filter((item) => item.id !== id);
  emit();
}

export function useToast(): {
  toasts: ToastMessage[];
  toast: typeof toast;
  dismiss: typeof dismissToast;
} {
  const [toasts, setToasts] = React.useState(memoryState);

  React.useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  return { toasts, toast, dismiss: dismissToast };
}
