/**
 * 12.1.a: the guardian consent email's subject and body, localised en-AU /
 * id-ID by the teen's own chosen display locale (`RegisterProfile.locale`)
 * — there is no guardian account or locale preference of its own to read,
 * so the teen's is what this uses, same as every other field on this row.
 * Kept short and plain per this ticket's own instruction: an invitation to
 * approve, never a contract — no legal language, no promises.
 */
export function guardianConsentEmailContent(
  locale: "en-AU" | "id-ID",
  displayName: string,
  approveUrl: string,
  revokeUrl: string,
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
    ].join("\n"),
  };
}
