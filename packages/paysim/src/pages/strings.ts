/**
 * Copy for the simulated Stripe pages. These are "Stripe's" pages, so their
 * strings live here and not in the web app's catalogues.
 */
export type Locale = "en" | "id";

const en = {
  bannerPayment: "Simulated payment, no real money",
  bannerOnboarding: "Simulated onboarding, no real money",
  payTo: "Pay {merchant}",
  saveCardTitle: "Save a card for {merchant}",
  cardNumber: "Card number",
  expiry: "Expiry (MM / YY)",
  expiryPlaceholder: "MM / YY",
  cvc: "CVC",
  pay: "Pay {amount}",
  saveCard: "Save card",
  back: "Back",
  testCardsOnly: "Use one of Stripe's test cards.",
  numberInvalid: "Your card number is invalid.",
  expiryInvalid: "Your card's expiration date is invalid.",
  expiryPast: "Your card's expiration date is in the past.",
  cvcInvalid: "Your card's security code is invalid.",
  declined: "Your card was declined.",
  authFailed:
    "We are unable to authenticate your payment method. Please choose a different payment method and try again.",
  expired: "This checkout session has expired.",
  complete: "This checkout session is already complete.",
  notFound: "We could not find this page.",
  closeThis: "You can close this page.",
  expiredPage: "This page has expired. Reload it and try again.",
  threeDsTitle: "Authentication required",
  threeDsBody: "Your bank asks you to confirm this payment. This is a simulated challenge.",
  threeDsComplete: "Complete authentication",
  threeDsFail: "Fail authentication",
  onboardingTitle: "Set up payouts for {merchant}",
  legalName: "Legal name",
  bsb: "BSB",
  accountNumber: "Account number",
  submit: "Submit",
  nameRequired: "Enter a legal name.",
  bankRefused: "Use one of Stripe's test bank accounts.",
  linkGone: "This link has expired.",
  quantity: "Qty {n}",
};

export type StringKey = keyof typeof en;

const id: Record<StringKey, string> = {
  bannerPayment: "Pembayaran simulasi, tanpa uang sungguhan",
  bannerOnboarding: "Onboarding simulasi, tanpa uang sungguhan",
  payTo: "Bayar {merchant}",
  saveCardTitle: "Simpan kartu untuk {merchant}",
  cardNumber: "Nomor kartu",
  expiry: "Masa berlaku (BB / TT)",
  expiryPlaceholder: "BB / TT",
  cvc: "CVC",
  pay: "Bayar {amount}",
  saveCard: "Simpan kartu",
  back: "Kembali",
  testCardsOnly: "Gunakan salah satu kartu uji Stripe.",
  numberInvalid: "Nomor kartu Anda tidak valid.",
  expiryInvalid: "Masa berlaku kartu Anda tidak valid.",
  expiryPast: "Masa berlaku kartu Anda sudah lewat.",
  cvcInvalid: "Kode keamanan kartu Anda tidak valid.",
  declined: "Kartu Anda ditolak.",
  authFailed:
    "Kami tidak dapat mengautentikasi metode pembayaran Anda. Pilih metode pembayaran lain dan coba lagi.",
  expired: "Sesi pembayaran ini sudah kedaluwarsa.",
  complete: "Sesi pembayaran ini sudah selesai.",
  notFound: "Halaman ini tidak ditemukan.",
  closeThis: "Anda dapat menutup halaman ini.",
  expiredPage: "Halaman ini sudah kedaluwarsa. Muat ulang dan coba lagi.",
  threeDsTitle: "Autentikasi diperlukan",
  threeDsBody: "Bank Anda meminta konfirmasi pembayaran ini. Ini adalah tantangan simulasi.",
  threeDsComplete: "Selesaikan autentikasi",
  threeDsFail: "Gagalkan autentikasi",
  onboardingTitle: "Atur pencairan untuk {merchant}",
  legalName: "Nama legal",
  bsb: "BSB",
  accountNumber: "Nomor rekening",
  submit: "Kirim",
  nameRequired: "Masukkan nama legal.",
  bankRefused: "Gunakan salah satu rekening bank uji Stripe.",
  linkGone: "Tautan ini sudah kedaluwarsa.",
  quantity: "Jml {n}",
};

const catalogues: Record<Locale, Record<StringKey, string>> = { en, id };

export type Translate = (key: StringKey, vars?: Record<string, string>) => string;

/** Variables are substituted raw: the layout escapes the final text. */
export function translator(locale: Locale): Translate {
  return (key, vars = {}) =>
    catalogues[locale][key].replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? "");
}

/** `en`/`id` as set on the session; `auto` or unset follows Accept-Language. */
export function pickLocale(
  sessionLocale: string | null,
  acceptLanguage: string | undefined,
): Locale {
  if (sessionLocale === "id" || sessionLocale === "en") return sessionLocale;
  return /^\s*id\b/i.test(acceptLanguage ?? "") ? "id" : "en";
}
