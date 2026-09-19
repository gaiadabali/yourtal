"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";

export interface RedeemErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Next.js route error boundaries must be Client Components. Reassures rather than alarms: nothing here can have moved the user's points, since a failed render happens before any confirmation. */
export default function RedeemError({ error, reset }: RedeemErrorProps) {
  useEffect(() => {
    console.error("redeem route error:", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 p-4 pb-24 text-center">
      <h1 className="text-lg font-sans font-semibold text-fg">
        Halaman penukaran tidak dapat dimuat
      </h1>
      <p className="text-sm font-sans text-fg-muted">
        Terjadi kesalahan saat memuat halaman ini. Poin Anda belum dipotong — silakan coba lagi.
      </p>
      <Button onClick={reset}>Coba lagi</Button>
    </main>
  );
}
