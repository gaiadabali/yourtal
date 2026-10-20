/**
 * 12.1.a / 1.3.c: the guardian consent email's subject and body, localised
 * en-AU / id-ID by the teen's own chosen display locale
 * (`RegisterProfile.locale`) — there is no guardian account or locale
 * preference of its own to read.
 *
 * Plain, short and calm, because Gmail sent the longer version (two links,
 * a paragraph of privacy promises, "not a contract") to Spam. One link only:
 * `/guardian/<token>` approves while the request is pending and withdraws
 * once it is granted, so no separate revoke link is needed. The subject
 * carries no user-entered text; the teen's display name is body-only. What
 * is kept, and why, lives behind `privacyUrl` (12.4.b), not in this email.
 */
export function guardianConsentEmailContent(
  locale: "en-AU" | "id-ID",
  displayName: string,
  link: {
    /** `AppConfig.webOrigin`. */
    readonly webOrigin: string;
    readonly token: string;
    readonly region: "AU" | "ID";
  },
): { readonly subject: string; readonly body: string } {
  const reviewUrl = `${link.webOrigin}/guardian/${encodeURIComponent(link.token)}`;
  // 12.4.b (#3, guardian half): the public site's locale segment is the
  // REGION ("au"/"id" — `apps/web/features/public/public-locale.ts`'s own
  // `PublicLocale`), never the display locale this function's own `locale`
  // parameter is; spelling it from `region` keeps this right if they diverge.
  const privacyUrl = `${link.webOrigin}/${link.region.toLowerCase()}/privacy`;
  if (locale === "id-ID") {
    return {
      subject: "Akun YourTal menunggu persetujuan Anda",
      body: [
        "Halo,",
        "",
        `${displayName} sedang mendaftar di YourTal dan memberikan alamat email ini sebagai alamat orang tua atau walinya. Karena usianya di bawah 18 tahun, akunnya perlu persetujuan Anda sebelum bisa dipakai.`,
        "",
        "Tinjau permintaannya:",
        "",
        reviewUrl,
        "",
        `Jika Anda tidak mengenal ${displayName}, atau tidak menduga email ini, abaikan saja email ini; akunnya tetap nonaktif.`,
        "",
        `Anda bisa mengubah keputusan nanti lewat halaman yang sama. Apa yang YourTal simpan tentang mereka, dan alasannya: ${privacyUrl}`,
        "",
        "YourTal · yourtal.gaiada.com",
      ].join("\n"),
    };
  }
  return {
    subject: "A YourTal account is waiting for your OK",
    body: [
      "Hi,",
      "",
      `${displayName} is signing up to YourTal and gave this address as their parent or guardian's. Because they're under 18, their account needs your OK before they can use it.`,
      "",
      "Review the request:",
      "",
      reviewUrl,
      "",
      `If you don't know ${displayName}, or didn't expect this, you can ignore this email; the account stays switched off.`,
      "",
      `You can change your mind later from the same page. What YourTal keeps about them, and why: ${privacyUrl}`,
      "",
      "YourTal · yourtal.gaiada.com",
    ].join("\n"),
  };
}
