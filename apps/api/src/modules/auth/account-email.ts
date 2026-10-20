/**
 * 1.3.c: the subject and body of the sign-up verification and password-reset
 * emails. Plain, short and specific on purpose: Gmail sent the old bare
 * "use this token" mails to Spam, while Snap Apps' calm, link-led ones reach
 * the inbox. The subject never carries user-entered text (spam filters weigh
 * it most); the display name appears in the body only.
 */
export type AccountEmailPurpose = "email_verification" | "password_reset";

export interface AccountEmailInput {
  readonly displayName: string;
  /** `AppConfig.webOrigin`: the link is built here so the token is always URL-encoded. */
  readonly webOrigin: string;
  readonly token: string;
  /** How long the link works, already phrased ("24 hours"). */
  readonly expiresIn: string;
}

const SIGN_OFF = "YourTal · yourtal.gaiada.com";

/** "60 minutes" / "24 hours" from a TTL in milliseconds. */
export function describeTtl(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "24 hours" : `${String(days)} days`;
  }
  if (hours >= 1 && Number.isInteger(hours)) {
    return hours === 1 ? "1 hour" : `${String(hours)} hours`;
  }
  return `${String(Math.round(ms / 60000))} minutes`;
}

export function accountEmailContent(
  purpose: AccountEmailPurpose,
  input: AccountEmailInput,
): { readonly subject: string; readonly body: string } {
  const path = purpose === "email_verification" ? "verify" : "reset";
  const link = `${input.webOrigin}/${path}?token=${encodeURIComponent(input.token)}`;
  if (purpose === "email_verification") {
    return {
      subject: "Confirm your email for YourTal",
      body: [
        `Hi ${input.displayName},`,
        "",
        "Please confirm this is your email address for YourTal. Open this link and press Confirm:",
        "",
        link,
        "",
        `The link works once and expires in ${input.expiresIn}.`,
        "",
        "If you didn't create a YourTal account, you can ignore this email.",
        "",
        SIGN_OFF,
      ].join("\n"),
    };
  }
  return {
    subject: "Reset your YourTal password",
    body: [
      `Hi ${input.displayName},`,
      "",
      "Someone asked to reset the password for your YourTal account. If it was you, open this link to choose a new one:",
      "",
      link,
      "",
      `It works once and expires in ${input.expiresIn}.`,
      "",
      "If you didn't ask, you can ignore this email; your password stays the same.",
      "",
      SIGN_OFF,
    ].join("\n"),
  };
}
