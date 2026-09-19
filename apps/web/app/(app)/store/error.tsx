"use client";

import { useEffect } from "react";
import { StoreErrorPanel } from "@/features/store/store-error-panel";

export interface StoreBoardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for the Store browse grid (YT-0420). Next.js requires
 * this exact filename and a `"use client"` default export receiving
 * `{ error, reset }`. Scoped to `store/`, so it overrides the group-root
 * `app/(app)/error.tsx` (which is Earn-board-specific copy) for this
 * segment and everything under it that does not define its own — this
 * fires for real today when `YOURTAL_DATA_SOURCE=live` is set, since no
 * BFF exists yet (see store-data.ts).
 */
export default function StoreBoardError({ error, reset }: StoreBoardErrorProps) {
  useEffect(() => {
    console.error("Store browse grid failed to load:", error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold text-fg">Store</h1>
      <StoreErrorPanel
        title="Store gagal dimuat"
        description="Terjadi kesalahan saat memuat katalog. Periksa koneksi kamu dan coba lagi."
        onRetry={reset}
      />
    </div>
  );
}
