/**
 * Emails sent when an account's sign-in methods change, and after a password
 * reset. Same plain, link-led shape as `account-email.ts` (greeting, one
 * sentence on why, one link, what to do if it wasn't you, sign-off), so they
 * reach the inbox. The link goes to Me, never carries a token, and the
 * subject never carries user-entered text: a passkey's name appears in the
 * body only.
 */
export type SecurityNotice =
  | { readonly kind: "passkey_added"; readonly name: string }
  | { readonly kind: "passkey_removed"; readonly name: string }
  | { readonly kind: "authenticator_on" }
  | { readonly kind: "authenticator_off" }
  | {
      readonly kind: "password_reset_summary";
      readonly passkeyNames: readonly string[];
      readonly authenticatorOn: boolean;
    };

export interface SecurityNoticeInput {
  readonly locale: "en-AU" | "id-ID";
  readonly displayName: string;
  readonly webOrigin: string;
}

const SIGN_OFF = "YourTal · yourtal.gaiada.com";

interface Copy {
  readonly subject: string;
  readonly lead: string;
  readonly ifNotYou: string;
}

function englishCopy(notice: SecurityNotice): Copy {
  const notYou =
    "If this wasn't you, reset your password now, then remove anything you don't recognise under Me → Passkeys and authenticator app:";
  switch (notice.kind) {
    case "passkey_added":
      return {
        subject: "A passkey was added to your YourTal account",
        lead: `A passkey named "${notice.name}" was added to your YourTal account. It can now sign you in.`,
        ifNotYou: notYou,
      };
    case "passkey_removed":
      return {
        subject: "A passkey was removed from your YourTal account",
        lead: `The passkey named "${notice.name}" was removed from your YourTal account.`,
        ifNotYou: notYou,
      };
    case "authenticator_on":
      return {
        subject: "An authenticator app was set up for YourTal",
        lead: "An authenticator app was set up for your YourTal account. Signing in with your password now also asks for a code from it.",
        ifNotYou: notYou,
      };
    case "authenticator_off":
      return {
        subject: "Your YourTal authenticator app was turned off",
        lead: "The authenticator app on your YourTal account was turned off. Signing in with your password no longer asks for a code.",
        ifNotYou: notYou,
      };
    case "password_reset_summary":
      return {
        subject: "Check how you sign in to YourTal",
        lead: `Your YourTal password was just reset. These can also sign you in: ${englishList(notice)}.`,
        ifNotYou:
          "If you don't recognise one of them, remove it under Me → Passkeys and authenticator app:",
      };
  }
}

function indonesianCopy(notice: SecurityNotice): Copy {
  const notYou =
    "Kalau ini bukan kamu, segera atur ulang kata sandimu, lalu hapus yang tidak kamu kenali di Saya → Passkey dan aplikasi autentikator:";
  switch (notice.kind) {
    case "passkey_added":
      return {
        subject: "Passkey baru ditambahkan ke akun YourTal-mu",
        lead: `Passkey bernama "${notice.name}" ditambahkan ke akun YourTal-mu. Passkey ini sekarang bisa dipakai untuk masuk.`,
        ifNotYou: notYou,
      };
    case "passkey_removed":
      return {
        subject: "Sebuah passkey dihapus dari akun YourTal-mu",
        lead: `Passkey bernama "${notice.name}" dihapus dari akun YourTal-mu.`,
        ifNotYou: notYou,
      };
    case "authenticator_on":
      return {
        subject: "Aplikasi autentikator dipasang untuk YourTal",
        lead: "Aplikasi autentikator dipasang untuk akun YourTal-mu. Masuk dengan kata sandi sekarang juga meminta kode dari aplikasi itu.",
        ifNotYou: notYou,
      };
    case "authenticator_off":
      return {
        subject: "Aplikasi autentikator YourTal-mu dimatikan",
        lead: "Aplikasi autentikator di akun YourTal-mu dimatikan. Masuk dengan kata sandi tidak lagi meminta kode.",
        ifNotYou: notYou,
      };
    case "password_reset_summary":
      return {
        subject: "Periksa cara kamu masuk ke YourTal",
        lead: `Kata sandi YourTal-mu baru saja diatur ulang. Ini juga bisa dipakai untuk masuk: ${indonesianList(notice)}.`,
        ifNotYou:
          "Kalau ada yang tidak kamu kenali, hapus di Saya → Passkey dan aplikasi autentikator:",
      };
  }
}

type Summary = Extract<SecurityNotice, { kind: "password_reset_summary" }>;

function englishList(notice: Summary): string {
  const items = notice.passkeyNames.map((name) => `the passkey "${name}"`);
  if (notice.authenticatorOn) items.push("an authenticator app");
  return items.join(", ");
}

function indonesianList(notice: Summary): string {
  const items = notice.passkeyNames.map((name) => `passkey "${name}"`);
  if (notice.authenticatorOn) items.push("aplikasi autentikator");
  return items.join(", ");
}

export function securityNoticeContent(
  notice: SecurityNotice,
  input: SecurityNoticeInput,
): { readonly subject: string; readonly body: string } {
  const indonesian = input.locale === "id-ID";
  const copy = indonesian ? indonesianCopy(notice) : englishCopy(notice);
  return {
    subject: copy.subject,
    body: [
      `${indonesian ? "Halo" : "Hi"} ${input.displayName},`,
      "",
      copy.lead,
      "",
      copy.ifNotYou,
      "",
      `${input.webOrigin}/me`,
      "",
      SIGN_OFF,
    ].join("\n"),
  };
}
