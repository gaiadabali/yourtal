"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";

export interface CheckpointErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Next.js error boundaries must be Client Components. Reassures rather than alarms: an earned reward from earlier chapters is never at risk here. */
export default function CheckpointError({ error, reset }: CheckpointErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 p-4 pb-24 text-center">
      <h1 className="text-lg font-sans font-semibold text-fg">Checkpoint tidak dapat dimuat</h1>
      <p className="text-sm font-sans text-fg-muted">
        Terjadi kesalahan saat memuat pertanyaan checkpoint. Reward yang sudah Anda dapatkan dari
        bagian video sebelumnya tetap aman.
      </p>
      <Button onClick={reset}>Coba lagi</Button>
    </main>
  );
}
