import { formatMerchantMoney } from "./merchant-money";
import type { MerchantRedemptionError } from "./merchant-redemption-errors";
import type { MerchantCurrency, MerchantLocale } from "./merchant-device";

export interface MerchantErrorCopy {
  heading: string;
  body: string;
}

function formatDateTime(iso: string, locale: MerchantLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * Plain-language, bilingual copy for every reason a redemption can be
 * blocked (this ticket's brief: "'Invalid' alone is useless — a customer
 * is standing there"). Every message says what happened AND what the
 * cashier should do next, never just a status word. Exhaustive `switch`
 * with a `never` default (docs/13b §4): a new `MerchantRedemptionError`
 * variant without matching copy fails the build.
 *
 * Money is formatted via `formatMerchantMoney` (`merchant-money.ts`), a
 * thin wrapper around `@yourtal/contracts/money/format`'s `formatMoney` —
 * safe in client code by design (that module is kept dependency-free
 * specifically so client components can format without paying for Zod).
 * `currency` is resolved once, server-side, in `merchant-data.ts`; this
 * function never imports the region contract.
 */
export function errorCopyFor(
  error: MerchantRedemptionError,
  locale: MerchantLocale,
  currency: MerchantCurrency,
): MerchantErrorCopy {
  const isId = locale === "id-ID";
  switch (error.type) {
    case "voucher_not_found":
      return isId
        ? {
            heading: "Voucher tidak ditemukan",
            body: "Kode ini tidak cocok dengan voucher manapun. Periksa lagi dengan pelanggan.",
          }
        : {
            heading: "Voucher not found",
            body: "That code doesn't match any voucher. Double-check it with the customer.",
          };
    case "already_redeemed":
      return isId
        ? {
            heading: "Voucher sudah dipakai",
            body: "Voucher ini sudah di-redeem sebelumnya dan tidak bisa dipakai lagi. Minta pelanggan menggunakan voucher lain atau metode pembayaran lain.",
          }
        : {
            heading: "Voucher already redeemed",
            body: "This voucher has already been used and can't be redeemed again. Ask the customer for another voucher or a different payment method.",
          };
    case "expired":
      return isId
        ? {
            heading: "Voucher sudah kedaluwarsa",
            body: `Voucher ini kedaluwarsa pada ${formatDateTime(error.expiresAt, locale)} dan tidak bisa dipakai. Beri tahu pelanggan bahwa voucher ini sudah tidak berlaku.`,
          }
        : {
            heading: "Voucher expired",
            body: `This voucher expired on ${formatDateTime(error.expiresAt, locale)} and can't be redeemed. Let the customer know it's no longer valid.`,
          };
    case "wrong_merchant":
      return isId
        ? {
            heading: "Voucher untuk toko lain",
            body: `Voucher ini untuk ${error.voucherMerchantName}, bukan ${error.deviceMerchantName}. Arahkan pelanggan ke toko yang tertera pada voucher.`,
          }
        : {
            heading: "Voucher is for a different store",
            body: `This voucher is for ${error.voucherMerchantName}, not ${error.deviceMerchantName}. Direct the customer to the store named on the voucher.`,
          };
    case "amount_not_positive":
      return isId
        ? {
            heading: "Jumlah tidak valid",
            body: "Masukkan jumlah belanja yang lebih besar dari nol.",
          }
        : { heading: "Invalid amount", body: "Enter an amount greater than zero." };
    case "amount_exceeds_remaining_value":
      return isId
        ? {
            heading: "Jumlah melebihi sisa nilai voucher",
            body: `Sisa nilai voucher ini hanya ${formatMerchantMoney(error.remainingValueMinor, currency)}. Kurangi jumlah, atau minta pelanggan membayar selisihnya dengan cara lain.`,
          }
        : {
            heading: "Amount exceeds the voucher's remaining value",
            body: `This voucher only has ${formatMerchantMoney(error.remainingValueMinor, currency)} remaining. Reduce the amount, or ask the customer to pay the difference another way.`,
          };
    case "requires_full_value_redemption":
      return isId
        ? {
            heading: "Voucher ini harus dipakai penuh",
            body: `Voucher ini punya minimum belanja dan harus di-redeem senilai penuh ${formatMerchantMoney(error.remainingValueMinor, currency)}.`,
          }
        : {
            heading: "This voucher must be redeemed in full",
            body: `This voucher has a minimum-spend policy and must be redeemed for its full remaining value of ${formatMerchantMoney(error.remainingValueMinor, currency)}.`,
          };
    case "network_error":
      return isId
        ? {
            heading: "Redeem gagal diproses",
            body: "Terjadi kendala jaringan saat memproses redeem. Voucher belum terpotong — coba lagi.",
          }
        : {
            heading: "Redemption couldn't be processed",
            body: "A network problem interrupted this redemption. The voucher has not been charged — try again.",
          };
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
