import { describe, expect, it } from "vitest";
import { securityNoticeContent } from "./security-notice-email";

const INPUT = { displayName: "Ana", webOrigin: "https://yourtal.gaiada.com" } as const;

describe("security notice emails", () => {
  it("names the passkey in the body only, and links to Me with no token", () => {
    const mail = securityNoticeContent(
      { kind: "passkey_added", name: "Work laptop" },
      { ...INPUT, locale: "en-AU" },
    );
    expect(mail.subject).toBe("A passkey was added to your YourTal account");
    expect(mail.subject).not.toContain("Work laptop");
    expect(mail.body).toContain('"Work laptop"');
    expect(mail.body).toContain("https://yourtal.gaiada.com/me\n");
    expect(mail.body).not.toContain("token");
    expect(mail.body).toContain("reset your password");
  });

  it("speaks Indonesian to an id-ID account", () => {
    const mail = securityNoticeContent({ kind: "authenticator_on" }, { ...INPUT, locale: "id-ID" });
    expect(mail.subject).toBe("Aplikasi autentikator dipasang untuk YourTal");
    expect(mail.body.startsWith("Halo Ana,")).toBe(true);
  });

  it("lists what can still sign in after a password reset", () => {
    const mail = securityNoticeContent(
      { kind: "password_reset_summary", passkeyNames: ["Phone"], authenticatorOn: true },
      { ...INPUT, locale: "en-AU" },
    );
    expect(mail.body).toContain('the passkey "Phone", an authenticator app');
  });
});
