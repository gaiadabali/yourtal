import { describe, expect, it } from "vitest";
import { accountEmailContent, describeTtl } from "./account-email";

// Not base64url, on purpose: proves the token is URL-encoded in the link.
const TOKEN = "a+b/c=d e";
const ENCODED = "a%2Bb%2Fc%3Dd%20e";
const INPUT = {
  displayName: "Mei <script>",
  webOrigin: "https://yourtal.gaiada.com",
  token: TOKEN,
  expiresIn: "24 hours",
};

describe("accountEmailContent (1.3.c)", () => {
  it("verification: one absolute link with the encoded token, a greeting, the expiry and the ignore line", () => {
    const { subject, body } = accountEmailContent("email_verification", INPUT);
    expect(subject).toBe("Confirm your email for YourTal");
    expect(body).toContain(`https://yourtal.gaiada.com/verify?token=${ENCODED}`);
    expect(body).not.toContain(TOKEN);
    expect(body.match(/https?:\/\//g)).toHaveLength(1);
    expect(body.startsWith("Hi Mei <script>,\n")).toBe(true);
    expect(body).toContain("expires in 24 hours");
    expect(body).toContain("If you didn't create a YourTal account, you can ignore this email.");
    expect(body.endsWith("YourTal · yourtal.gaiada.com")).toBe(true);
  });

  it("reset: one absolute link with the encoded token, a greeting, the expiry and the ignore line", () => {
    const { subject, body } = accountEmailContent("password_reset", {
      ...INPUT,
      expiresIn: "1 hour",
    });
    expect(subject).toBe("Reset your YourTal password");
    expect(body).toContain(`https://yourtal.gaiada.com/reset?token=${ENCODED}`);
    expect(body.match(/https?:\/\//g)).toHaveLength(1);
    expect(body.startsWith("Hi Mei <script>,\n")).toBe(true);
    expect(body).toContain("expires in 1 hour");
    expect(body).toContain("your password stays the same");
    expect(body.endsWith("YourTal · yourtal.gaiada.com")).toBe(true);
  });

  it("never puts the display name in a subject", () => {
    for (const purpose of ["email_verification", "password_reset"] as const) {
      expect(accountEmailContent(purpose, INPUT).subject).not.toContain("Mei");
    }
  });
});

describe("describeTtl", () => {
  it("phrases the real token lifetimes", () => {
    expect(describeTtl(60 * 60 * 1000)).toBe("1 hour");
    expect(describeTtl(24 * 60 * 60 * 1000)).toBe("24 hours");
    expect(describeTtl(7 * 24 * 60 * 60 * 1000)).toBe("7 days");
    expect(describeTtl(90 * 60 * 1000)).toBe("90 minutes");
  });
});
