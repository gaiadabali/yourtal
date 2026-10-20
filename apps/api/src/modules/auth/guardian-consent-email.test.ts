import { describe, expect, it } from "vitest";
import { guardianConsentEmailContent } from "./guardian-consent-email";

const TOKEN = "a+b/c=d e";
const LINK = {
  webOrigin: "https://yourtal.gaiada.com",
  token: TOKEN,
  region: "AU" as const,
};
const NAME = "Mei Tanaka";

describe("guardianConsentEmailContent (1.3.c)", () => {
  for (const [locale, subject, region] of [
    ["en-AU", "A YourTal account is waiting for your OK", "au"],
    ["id-ID", "Akun YourTal menunggu persetujuan Anda", "id"],
  ] as const) {
    it(`${locale}: a fixed subject, ONE review link with the encoded token, the privacy link, the name in the body only`, () => {
      const out = guardianConsentEmailContent(locale, NAME, {
        ...LINK,
        region: region === "au" ? "AU" : "ID",
      });
      expect(out.subject).toBe(subject);
      expect(out.subject).not.toContain("Mei");
      expect(out.body).toContain("https://yourtal.gaiada.com/guardian/a%2Bb%2Fc%3Dd%20e\n");
      expect(out.body).not.toContain(TOKEN);
      expect(out.body).not.toContain("action=revoke");
      expect(out.body).toContain(`https://yourtal.gaiada.com/${region}/privacy`);
      expect(out.body.match(/https?:\/\//g)).toHaveLength(2);
      expect(out.body).toContain(NAME);
      expect(out.body.endsWith("YourTal · yourtal.gaiada.com")).toBe(true);
    });
  }

  it("drops the contract line and the privacy promises", () => {
    const en = guardianConsentEmailContent("en-AU", NAME, LINK).body;
    expect(en).not.toMatch(/contract|never sold/i);
    const id = guardianConsentEmailContent("id-ID", NAME, LINK).body;
    expect(id).not.toMatch(/kontrak|tidak pernah dijual/i);
  });
});
