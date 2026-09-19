import Link from "next/link";
import { Button } from "@yourtal/ui/button";

/** Rendered when `getWalletVoucher` finds no voucher for the given id (YT-0424). */
export default function WalletVoucherNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 p-10 text-center">
      <h1 className="text-lg font-semibold text-fg">Voucher tidak ditemukan</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        Voucher ini mungkin sudah tidak ada atau tautannya salah. Coba kembali ke wallet untuk melihat voucher yang kamu
        punya.
      </p>
      <Button asChild variant="secondary">
        <Link href="/wallet">Kembali ke Wallet</Link>
      </Button>
    </div>
  );
}
