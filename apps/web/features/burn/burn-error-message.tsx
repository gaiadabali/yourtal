import { asDisplayPoints, formatPoints } from "@yourtal/contracts/money/format";
import type { BurnError } from "./burn-errors";

export interface BurnErrorMessageProps {
  error: BurnError;
}

function formatIndonesianDateTime(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short" }).format(new Date(iso));
}

interface ErrorCopy {
  heading: string;
  body: string;
}

function copyFor(error: BurnError): ErrorCopy {
  switch (error.type) {
    case "insufficient_points":
      return {
        heading: "Poin Anda belum cukup",
        body: `Anda masih kurang ${formatPoints(asDisplayPoints(error.short))} untuk menukar item ini. Tonton video atau selesaikan aktivitas lain untuk menambah poin, lalu coba lagi.`,
      };
    case "holdback_blocks":
      // Plain language, no transaction jargon (docs/tasks/phase-u-ui.md
      // YT-0422's fourth acceptance criterion): says WHEN the points unlock
      // and WHY they are held, per the holdback's actual purpose
      // (docs/02-architecture.md: "Fraud detection is statistical and
      // lags the event" — the delay is what turns a stolen balance into a
      // clawback instead of a loss).
      return {
        heading: "Sebagian poin Anda masih ditahan sementara",
        body: `Poin Anda sebenarnya cukup untuk menukar item ini, tapi sebagian baru saja Anda dapatkan dan masih diperiksa sistem untuk mencegah kecurangan. Poin tersebut akan bisa dipakai mulai ${formatIndonesianDateTime(error.unlocksAt)}.`,
      };
    case "lock_expired":
      return {
        heading: "Harga ini sudah tidak berlaku",
        body: `Waktu kunci harga Anda sudah habis pada ${formatIndonesianDateTime(error.expiredAt)}. Harga dan ketersediaan bisa berubah, jadi kami tidak bisa melanjutkan penukaran dengan harga lama. Muat ulang untuk melihat harga terbaru.`,
      };
    case "listing_unavailable":
      return {
        heading: "Item ini sudah tidak tersedia",
        body: "Stoknya baru saja habis. Coba cari penawaran serupa lainnya di Toko.",
      };
    case "redemption_failed":
      return {
        heading: "Penukaran gagal",
        body: "Terjadi kendala saat memproses penukaran Anda. Poin Anda belum terpotong — silakan coba lagi.",
      };
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

/**
 * Plain-language, Indonesian, jargon-free copy for every reason a
 * redemption can be blocked (docs/tasks/phase-u-ui.md YT-0422's fourth
 * acceptance criterion — "Holdback explained in plain language when it
 * blocks a redemption"). `copyFor` switches exhaustively over
 * `BurnError["type"]` with a `never` default (docs/13b section 4): adding a
 * new `BurnError` variant without adding copy here fails the build instead
 * of silently rendering a blank message.
 */
export function BurnErrorMessage({ error }: BurnErrorMessageProps) {
  const { heading, body } = copyFor(error);
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-lg border border-danger bg-danger/10 p-4">
      <p className="text-sm font-sans font-semibold text-danger">{heading}</p>
      <p className="text-sm font-sans text-fg">{body}</p>
    </div>
  );
}
