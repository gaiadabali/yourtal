"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export interface RefreshWhileWaitingProps {
  /** Shown once the page has stopped refreshing by itself. */
  readonly stillWaiting: string;
  readonly intervalMs?: number;
  readonly attempts?: number;
}

/**
 * Re-renders the server page every few seconds while a payment or a card
 * waits for the processor's webhook, then stops and says so, rather than
 * polling for ever.
 */
export function RefreshWhileWaiting({
  stillWaiting,
  intervalMs = 3_000,
  attempts = 20,
}: RefreshWhileWaitingProps) {
  const router = useRouter();
  const [left, setLeft] = useState(attempts);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => {
      setLeft((n) => n - 1);
      router.refresh();
    }, intervalMs);
    return () => clearTimeout(timer);
  }, [left, intervalMs, router]);

  return left <= 0 ? <p>{stillWaiting}</p> : null;
}
