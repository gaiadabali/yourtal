"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";

export interface CheckpointErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Next.js error boundaries must be Client Components. Reassures rather
 * than alarms — but honestly: decision O-1 (docs/16-decisions.md) makes
 * the reward all-or-nothing, granted only after the full video is watched
 * AND the checkpoint is answered, so this previously told the user their
 * reward "from earlier chapters" was already safe, which is exactly the
 * false promise O-1 exists to prevent. The true reassurance is that
 * nothing is lost by retrying — the video progress and the chance to
 * answer are still there.
 */
export default function CheckpointError({ error, reset }: CheckpointErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 p-4 pb-24 text-center">
      <h1 className="text-lg font-sans font-semibold text-fg">Checkpoint tidak dapat dimuat</h1>
      <p className="text-sm font-sans text-fg-muted">
        Terjadi kesalahan saat memuat pertanyaan checkpoint. Progres Anda tersimpan — coba lagi
        untuk melanjutkan. Reward hanya diberikan setelah Anda menonton seluruh video dan menjawab
        pertanyaan checkpoint.
      </p>
      <Button onClick={reset}>Coba lagi</Button>
    </main>
  );
}
