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
      {/* Decision O-1 (docs/16-decisions.md): nothing is earned until the
          whole video is watched AND the checkpoint questions are answered,
          so this must never reassure the user that a reward is already
          secured — it previously said "anything you already earned...
          was not lost", which is false under O-1. Your saved position IS
          real (resume-position.ts), so that is the honest reassurance. */}
      <p className="text-sm font-sans text-fg-muted">
        Something went wrong loading this campaign. Your progress is saved, so you can pick up where
        you left off. No reward is paid until you finish the whole video and answer the checkpoint
        questions.
      </p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
