import Link from "next/link";
import { Button } from "@yourtal/ui/button";

/** Rendered when `getListing` finds no listing for the given id (YT-0421). */
export default function StoreOfferNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-10 text-center">
      <h1 className="text-lg font-semibold text-fg">Item tidak ditemukan</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        Item ini mungkin sudah tidak tersedia atau tautannya salah. Coba kembali ke Store untuk melihat katalog yang
        masih aktif.
      </p>
      <Button asChild variant="secondary">
        <Link href="/store">Kembali ke Store</Link>
      </Button>
    </div>
  );
}
