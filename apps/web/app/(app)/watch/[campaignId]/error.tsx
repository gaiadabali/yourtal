"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";

export interface WatchErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// Next.js route error boundaries must be Client Components.
export default function WatchError({ error, reset }: WatchErrorProps) {
  useEffect(() => {
    console.error("watch route error:", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-sans font-semibold text-fg">This video couldn&apos;t load</h1>
      <p className="text-sm font-sans text-fg-muted">
        Something went wrong loading this campaign. Anything you already earned on this device was
        not lost.
      </p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
