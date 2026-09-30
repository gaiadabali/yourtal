/**
 * 12.1.a: the guardian consent email's subject and body, localised en-AU /
 * id-ID by the teen's own chosen display locale (`RegisterProfile.locale`)
 * — there is no guardian account or locale preference of its own to read,
 * so the teen's is what this uses, same as every other field on this row.
 * Kept short and plain per this ticket's own instruction: an invitation to
 * approve, never a contract — no legal language, no promises.
 *
 * 12.4.b (#3, guardian half): one short, plain paragraph on what is kept —
 * name, date of birth, email, and what they watch and earn — and what
 * never happens to it (never sold, never used to profile them, never
 * shared with a business except as an anonymous total), linking to the
 * full privacy page. This is a summary for a guardian who has no account
 * and no other way to find that page; it is not itself the privacy notice.
 */
export function guardianConsentEmailContent(
  locale: "en-AU" | "id-ID",
  displayName: string,
  approveUrl: string,
  revokeUrl: string,
  privacyUrl: string,
): { readonly subject: string; readonly body: string } {
  if (locale === "id-ID") {
    return {
      subject: "Persetujuan orang tua/wali untuk YourTal",
      body: [
        `${displayName} ingin membuat akun YourTal untuk usia 13-17 tahun.`,
        "Ini adalah undangan untuk menyetujui, bukan sebuah kontrak.",
        "",
        `Setujui: ${approveUrl}`,
        `Batalkan persetujuan kapan saja, dengan tautan yang sama: ${revokeUrl}`,
        "",
        "Yang kami simpan: nama, tanggal lahir, dan email mereka, serta apa yang " +
          "mereka tonton dan hasilkan. Data ini tidak pernah dijual, tidak pernah " +
          "digunakan untuk membuat profil mereka, dan tidak dibagikan ke bisnis " +
          `kecuali sebagai total anonim. Selengkapnya: ${privacyUrl}`,
      ].join("\n"),
    };
  }
  return {
    subject: "Guardian approval for YourTal",
    body: [
      `${displayName} wants to create a YourTal account for ages 13-17.`,
      "This is an invitation to approve, not a contract.",
      "",
      `Approve: ${approveUrl}`,
      `Withdraw approval at any time, with the same link: ${revokeUrl}`,
      "",
      "What we keep: their name, date of birth and email, and what they watch " +
        "and earn. It's never sold, never used to build a profile of them, and " +
        `never shared with a business except as an anonymous total. More: ${privacyUrl}`,
    ].join("\n"),
  };
}
