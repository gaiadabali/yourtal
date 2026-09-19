import type { OnboardingCopy } from "./onboarding-copy";

/**
 * Bahasa Indonesia copy for the `id-ID` locale (a user who picks Indonesia
 * at registration — docs/tasks/phase-u-ui.md YT-0430's region criterion).
 * See `onboarding-copy-en-au.ts` for the English counterpart and the note on
 * why the OTP copy is deliberately not framed as identity verification.
 */
export const idIdOnboardingCopy: OnboardingCopy = {
  common: {
    back: "Kembali",
    stepPrefix: "Langkah",
    stepJoiner: "dari",
  },
  consent: {
    heading: "Sebelum lanjut",
    intro:
      "Kami meminta beberapa izin secara terpisah, bukan satu persetujuan untuk semuanya. Masing-masing hanya berlaku untuk apa yang tertulis di bawah, tidak lebih.",
    essential: {
      title: "Buat akun saya dan verifikasi nomor HP",
      body: "Kami mengumpulkan nomor HP-mu untuk membuat akun dan memastikan kamu orang yang benar-benar unik saat mendaftar. Kode sekali pakai ini tidak membuktikan identitasmu — hanya memastikan nomor ini belum pernah dipakai mendaftar. Wajib untuk menggunakan YourTal.",
    },
    personalize: {
      title: "Personalisasi kampanye yang saya lihat",
      body: "Kami menggunakan minat yang kamu pilih berikutnya untuk menentukan kampanye earning mana yang ditampilkan lebih dulu. Kalau ini tidak diaktifkan, kamu tetap melihat semua kampanye — hanya saja tidak diurutkan khusus untukmu.",
    },
    marketing: {
      title: "Kirimi saya pesan promosi",
      body: "Kami mungkin mengirim SMS atau WhatsApp tentang kampanye, hadiah, atau promosi baru. Nonaktif secara default. Bisa diubah kapan saja di Saya → Pengaturan.",
    },
    requiredHint: "wajib untuk lanjut",
    continueLabel: "Lanjutkan",
  },
  verify: {
    phoneHeading: "Berapa nomor HP-mu?",
    phoneIntro: "Kami akan mengirim kode sekali pakai lewat SMS untuk memastikan ini benar kamu.",
    phoneLabel: "Nomor HP",
    phoneHelp: "Tarif SMS standar mungkin berlaku.",
    sendCode: "Kirim kode",
    sending: "Mengirim kode…",
    codeHeading: "Masukkan kode",
    codeSentPrefix: "Kami mengirim kode 6 digit ke",
    codeLabel: "Kode 6 digit",
    verifyCta: "Verifikasi",
    verifying: "Memeriksa…",
    wrongCode: "Kode tidak cocok. Periksa kembali angkanya dan coba lagi.",
    resend: "Kirim ulang kode",
    resendCooldownPrefix: "Kamu bisa kirim ulang dalam",
    resendCooldownSuffix: " detik",
    wrongNumber: "Salah nomor? Ubah di sini",
    rateLimitedHeading: "Terlalu banyak percobaan",
    rateLimitedBody: "Demi keamanan, pengiriman kode baru untuk nomor ini kami hentikan sementara.",
    rateLimitedRetryPrefix: "Kamu bisa coba lagi pukul",
    verified: "Nomor terkonfirmasi",
    demoCodeHint: "Mode prototipe: SMS sungguhan tidak dikirim. Gunakan kode 123456.",
    otpDisclaimer:
      "Kode ini memastikan nomor ini belum pernah dipakai mendaftar — bukan bukti identitasmu.",
  },
  interests: {
    heading: "Apa yang kamu suka?",
    intro:
      "Pilih beberapa supaya kami bisa menampilkan kampanye terbaik lebih dulu. Bisa diubah kapan saja di Saya → Pengaturan.",
    continueLabel: "Lanjutkan",
    skipLabel: "Lewati dulu",
    selectedSuffix: "dipilih",
  },
  done: {
    heading: "Kamu sudah masuk",
    bodyIntro: "Akunmu sudah disiapkan untuk",
    currencyPrefix: "Harga dan hadiah akan ditampilkan dalam",
    cta: "Mulai earning",
    exampleRewardLabel: "Contoh hadiah",
  },
};
