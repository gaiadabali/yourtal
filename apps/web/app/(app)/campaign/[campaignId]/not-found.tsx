import Link from "next/link";
import { Button } from "@yourtal/ui/button";

/** Rendered when `getCampaign` finds no campaign for the given id (YT-0411). */
export default function CampaignNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-10 text-center">
      <h1 className="text-lg font-semibold text-fg">Campaign tidak ditemukan</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        Campaign ini mungkin sudah berakhir atau tautannya salah. Coba kembali ke papan earn untuk
        melihat campaign yang masih berjalan.
      </p>
      <Button asChild variant="secondary">
        <Link href="/">Kembali ke Earn</Link>
      </Button>
    </div>
  );
}
