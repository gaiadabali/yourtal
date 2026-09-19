"use client";

import { useEffect } from "react";
import { Button } from "@yourtal/ui/button";

export interface WalletVoucherDetailErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Error boundary for the voucher detail screen (YT-0424). See app/(app)/error.tsx for the same pattern. */
export default function WalletVoucherDetailError({ error, reset }: WalletVoucherDetailErrorProps) {
  useEffect(() => {
    console.error("Voucher detail failed to load:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 p-10 text-center">
      <h1 className="text-lg font-semibold text-fg">Voucher gagal dimuat</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        Terjadi kesalahan saat memuat voucher ini. Periksa koneksi kamu dan coba lagi.
      </p>
      <Button onClick={reset}>Coba lagi</Button>
    </div>
  );
}
