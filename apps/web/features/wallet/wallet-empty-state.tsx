import Link from "next/link";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";

/**
 * Shown instead of the balance card when the wallet is genuinely empty —
 * zero available, zero pending and zero expiring points, and no vouchers
 * held at all. YT-0423's "empty state teaches the loop rather than showing
 * a zero": a brand-new user should learn how earning works and be pointed
 * straight at the Earn board, not be told "0 poin" and left to guess.
 */
export function WalletEmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-base font-semibold text-fg">Belum ada poin di sini</p>
        <p className="max-w-sm text-sm text-fg-muted">
          Poin didapat dengan menonton video singkat dari merchant favoritmu. Selesaikan satu video
          di papan Earn untuk mulai mengumpulkan poin, lalu tukarkan dengan voucher di Store.
        </p>
        <Button asChild>
          <Link href="/">Cari video di Earn</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
