"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";

export interface WalletErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Error boundary for `/wallet` (YT-0423). See app/(app)/error.tsx for the same pattern. */
export default function WalletError({ error, reset }: WalletErrorProps) {
  useEffect(() => {
    console.error("Wallet failed to load:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 p-10 text-center">
      <h1 className="text-lg font-semibold text-fg">Wallet gagal dimuat</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        Terjadi kesalahan saat memuat wallet-mu. Periksa koneksi kamu dan coba lagi.
      </p>
      <Button onClick={reset}>Coba lagi</Button>
    </div>
  );
}
