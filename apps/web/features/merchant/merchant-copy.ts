import type { MerchantLocale } from "./merchant-device";

/**
 * Static, staff-facing chrome copy for the redemption portal, in both
 * markets' languages (docs/17-surfaces-and-roles.md: "Australia is the
 * real market and Indonesia is the proving ground"). Unlike the rest of
 * `apps/web`, which is hardcoded Bahasa Indonesia today (no i18n framework
 * is installed — see root `app/layout.tsx`'s hardcoded `lang="id-ID"`),
 * this ticket's brief explicitly requires copy that works in both
 * `en-AU` and `id-ID`, so this feature carries its own small locale
 * dictionary keyed by `MerchantDevice.locale` rather than a hardcoded
 * string. This is deliberately NOT a general-purpose i18n solution — just
 * enough to keep this one surface honest about which market it is
 * speaking to. Wiring the rest of the app to a real i18n library is out of
 * this ticket's scope.
 *
 * Plain language throughout, no transaction jargon (docs/17 §2.2: casual
 * staff, no attentive-owner-at-a-desk assumptions).
 */
export interface MerchantCopy {
  portalHeading: string;
  deviceBadgePrefix: string;
  tabScan: string;
  tabManual: string;
  manualCodeLabel: string;
  manualCodeHelp: string;
  manualCodePlaceholder: string;
  lookUpButton: string;
  scanHint: string;
  scanUnavailable: string;
  scanPermissionDenied: string;
  scanNoCamera: string;
  switchToManual: string;
  notFoundHeading: string;
  notFoundBody: string;
  unreadableHeading: string;
  unreadableBody: string;
  tryAgainButton: string;
  amountLabel: string;
  amountHelp: string;
  confirmButton: string;
  backButton: string;
  processingAuthorize: string;
  processingCapture: string;
  successHeading: string;
  queuedHeading: string;
  queuedBody: string;
  newRedemptionButton: string;
  offlineLabel: string;
  syncingLabel: string;
  offlineBanner: string;
  backOnlineBanner: string;
  syncingBanner: string;
  todayHeading: string;
  todayTotalLabel: string;
  todayPendingLabel: string;
  todayEmpty: string;
  todayStatusPending: string;
  todayStatusFailed: string;
}

const idID: MerchantCopy = {
  portalHeading: "Redeem Voucher",
  deviceBadgePrefix: "Perangkat",
  tabScan: "Pindai QR",
  tabManual: "Masukkan kode",
  manualCodeLabel: "Kode voucher",
  manualCodeHelp: "Minta pelanggan menunjukkan kode di layar Wallet mereka.",
  manualCodePlaceholder: "Contoh: AB12CD34",
  lookUpButton: "Cari voucher",
  scanHint: "Arahkan kamera ke kode QR di layar pelanggan.",
  scanUnavailable: 'Kamera tidak tersedia di perangkat ini. Gunakan tab "Masukkan kode" di bawah.',
  scanPermissionDenied:
    'Izin kamera ditolak. Gunakan tab "Masukkan kode" di bawah, atau aktifkan izin kamera di pengaturan browser.',
  scanNoCamera: 'Tidak ada kamera yang terdeteksi. Gunakan tab "Masukkan kode" di bawah.',
  switchToManual: "Masukkan kode secara manual",
  notFoundHeading: "Kode tidak ditemukan",
  notFoundBody:
    "Tidak ada voucher dengan kode ini. Periksa kembali kode dengan pelanggan, atau minta mereka membuka ulang halaman voucher di Wallet.",
  unreadableHeading: "Kode QR tidak terbaca",
  unreadableBody:
    "Kode ini tidak bisa diverifikasi — mungkin layar bergerak atau kode sudah berganti. Minta pelanggan menahan layar tetap diam dan coba pindai lagi, atau masukkan kode secara manual.",
  tryAgainButton: "Coba lagi",
  amountLabel: "Jumlah yang dipakai",
  amountHelp: "Nilai belanja pelanggan yang akan dipotong dari voucher ini.",
  confirmButton: "Konfirmasi redeem",
  backButton: "Kembali",
  processingAuthorize: "Memverifikasi voucher…",
  processingCapture: "Menyelesaikan redeem…",
  successHeading: "Berhasil di-redeem",
  queuedHeading: "Menunggu koneksi",
  queuedBody:
    "Perangkat sedang offline. Redeem ini disimpan dan akan dikonfirmasi otomatis begitu koneksi kembali — belum berhasil sampai saat itu.",
  newRedemptionButton: "Redeem voucher lain",
  offlineLabel: "Offline",
  syncingLabel: "Menyinkronkan",
  offlineBanner: "Offline — redeem baru akan disimpan dan menunggu sinkronisasi.",
  backOnlineBanner: "Koneksi kembali. Menyinkronkan redeem yang tertunda…",
  syncingBanner: "Menyinkronkan…",
  todayHeading: "Redeem hari ini",
  todayTotalLabel: "Total terkonfirmasi",
  todayPendingLabel: "menunggu sinkronisasi",
  todayEmpty: "Belum ada redeem hari ini.",
  todayStatusPending: "Menunggu",
  todayStatusFailed: "Gagal",
};

const enAU: MerchantCopy = {
  portalHeading: "Redeem Voucher",
  deviceBadgePrefix: "Device",
  tabScan: "Scan QR",
  tabManual: "Enter code",
  manualCodeLabel: "Voucher code",
  manualCodeHelp: "Ask the customer to show the code on their Wallet screen.",
  manualCodePlaceholder: "e.g. AB12CD34",
  lookUpButton: "Look up voucher",
  scanHint: "Point the camera at the QR code on the customer's screen.",
  scanUnavailable: 'Camera isn\'t available on this device. Use the "Enter code" tab below.',
  scanPermissionDenied:
    'Camera permission was denied. Use the "Enter code" tab below, or allow camera access in your browser settings.',
  scanNoCamera: 'No camera was found. Use the "Enter code" tab below.',
  switchToManual: "Enter the code manually",
  notFoundHeading: "Code not found",
  notFoundBody:
    "No voucher matches that code. Double check it with the customer, or ask them to reopen the voucher page in their Wallet.",
  unreadableHeading: "Couldn't read that code",
  unreadableBody:
    "That code couldn't be verified — the screen may have moved or the code may have just rotated. Ask the customer to hold their screen steady and scan again, or enter the code manually.",
  tryAgainButton: "Try again",
  amountLabel: "Amount to redeem",
  amountHelp: "The value of the customer's purchase to deduct from this voucher.",
  confirmButton: "Confirm redemption",
  backButton: "Back",
  processingAuthorize: "Verifying voucher…",
  processingCapture: "Completing redemption…",
  successHeading: "Redeemed",
  queuedHeading: "Waiting for connection",
  queuedBody:
    "This device is offline. The redemption is saved and will confirm automatically once the connection returns — it has not succeeded yet.",
  newRedemptionButton: "Redeem another voucher",
  offlineLabel: "Offline",
  syncingLabel: "Syncing",
  offlineBanner: "Offline — new redemptions will be saved and wait to sync.",
  backOnlineBanner: "Connection restored. Syncing pending redemptions…",
  syncingBanner: "Syncing…",
  todayHeading: "Today's redemptions",
  todayTotalLabel: "Confirmed total",
  todayPendingLabel: "waiting to sync",
  todayEmpty: "No redemptions yet today.",
  todayStatusPending: "Pending",
  todayStatusFailed: "Failed",
};

const MERCHANT_COPY: Record<MerchantLocale, MerchantCopy> = {
  "id-ID": idID,
  "en-AU": enAU,
};

export function getMerchantCopy(locale: MerchantLocale): MerchantCopy {
  return MERCHANT_COPY[locale];
}
