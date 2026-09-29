"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";

export interface ChannelErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// Next.js route error boundaries must be Client Components.
export default function ChannelError({ error, reset }: ChannelErrorProps) {
  useEffect(() => {
    console.error("channel route error:", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-sans font-semibold text-fg">This channel couldn&apos;t load</h1>
      <p className="text-sm font-sans text-fg-muted">Something went wrong. Try again.</p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
