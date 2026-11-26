import { describe, expect, it } from "vitest";
import { loadAppConfig } from "./app-config";

const BASE = {
  DATABASE_URL: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
  CHECKPOINT_TOKEN_SECRET: "test-only-checkpoint-signing-key-not-a-real-secret",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "test-only-webhook-secret-encryption-key-not-a-real-secret",
  SNAP_APP_PARTNER_SECRET: "test-only-snap-app-partner-secret-not-a-real-secret",
};
const key = (letter: string): string => letter.repeat(43);

function spambank(extra: Record<string, string> = {}) {
  const config = loadAppConfig({ ...BASE, ...extra });
  if (config.spambank === undefined) throw new Error("no spambank config");
  return config.spambank;
}

describe("Spambank settings", () => {
  it("defaults to a safe, switched-on setup with auto-reply off", () => {
    const s = spambank();
    expect(s.enabled).toBe(true);
    expect(s.mailDomain).toBe("yourtal.gaiada.com");
    expect(s.replyDomain).toBe("spambank.yourtal.gaiada.com");
    expect(s.publicHost).toBe("mail.yourtal.gaiada.com");
    expect(s.authservId).toBe("mail.yourtal.gaiada.com");
    expect(s.quotaBytes).toBe(2_147_483_648);
    expect(s.autoreply).toStrictEqual({ mode: "off", dailyCap: 200 });
    expect(s.corsOrigins).toStrictEqual([]);
    expect(s.ownDomains).toStrictEqual(["gaiada.com", "freetaxreturns.com.au", "yourtal.com"]);
    expect(s.alertEmails).toStrictEqual([]);
    expect(s.bannerUrl).toBe("https://yourtal.gaiada.com/studio/onboarding");
    expect(s.stalwartUrl).toBeUndefined();
    expect(s.tokenKey).toBeUndefined();
  });

  it("reads the staging values of BUILD.md section 5.8", () => {
    const s = spambank({
      SPAMBANK_STALWART_URL: "http://127.0.0.1:18080",
      SPAMBANK_STALWART_API_KEY: "API_abcdefghijkl",
      SPAMBANK_CREDENTIAL_KEY: key("a"),
      SPAMBANK_TOKEN_KEY: key("b"),
      SPAMBANK_WEBHOOK_SECRET: key("c"),
      SPAMBANK_OPTOUT_KEY: key("d"),
      SPAMBANK_AUTHSERV_ID: "mx.yourtal.gaiada.com",
      SPAMBANK_CORS_ORIGINS:
        "https://snapapp.gaiada.com, https://freetaxreturns.com.au,https://www.freetaxreturns.com.au",
      SPAMBANK_ENABLED: "1",
      SPAMBANK_AUTOREPLY_MODE: "dry_run",
      SPAMBANK_AUTOREPLY_DAILY_CAP: "50",
      SPAMBANK_ALERT_EMAILS: "ops@gaiada.com,web@gaiada.com",
    });
    expect(s.stalwartUrl).toBe("http://127.0.0.1:18080");
    expect(s.tokenKey).toBe(key("b"));
    expect(s.authservId).toBe("mx.yourtal.gaiada.com");
    expect(s.corsOrigins).toStrictEqual([
      "https://snapapp.gaiada.com",
      "https://freetaxreturns.com.au",
      "https://www.freetaxreturns.com.au",
    ]);
    expect(s.autoreply).toStrictEqual({ mode: "dry_run", dailyCap: 50 });
    expect(s.alertEmails).toStrictEqual(["ops@gaiada.com", "web@gaiada.com"]);
  });

  it.each([
    ["0", false],
    ["false", false],
    ["1", true],
    ["true", true],
  ])("SPAMBANK_ENABLED=%s is %s", (value, expected) => {
    expect(spambank({ SPAMBANK_ENABLED: value }).enabled).toBe(expected);
  });

  it("refuses a typo in the switch or the auto-reply mode instead of guessing", () => {
    expect(() => spambank({ SPAMBANK_ENABLED: "off" })).toThrow();
    expect(() => spambank({ SPAMBANK_AUTOREPLY_MODE: "Live" })).toThrow();
  });

  it("refuses a short secret", () => {
    expect(() => spambank({ SPAMBANK_TOKEN_KEY: "short" })).toThrow();
  });

  it("refuses two keys with the same value: the credential key must not double as another", () => {
    expect(() =>
      spambank({ SPAMBANK_CREDENTIAL_KEY: key("a"), SPAMBANK_TOKEN_KEY: key("a") }),
    ).toThrow(/same value/);
  });

  it("redirect mode needs somewhere to redirect to", () => {
    expect(() => spambank({ SPAMBANK_AUTOREPLY_MODE: "redirect" })).toThrow(/REDIRECT_TO/);
    expect(
      spambank({
        SPAMBANK_AUTOREPLY_MODE: "redirect",
        SPAMBANK_AUTOREPLY_REDIRECT_TO: "tester@example.com",
      }).autoreply.redirectTo,
    ).toBe("tester@example.com");
  });

  it("keeps the reply domain apart from the mailbox domain", () => {
    expect(() => spambank({ SPAMBANK_REPLY_DOMAIN: "yourtal.gaiada.com" })).toThrow(/differ/);
  });

  it.each([
    "*",
    "http://snapapp.gaiada.com",
    "https://snapapp.gaiada.com/",
    "https://x.test/path",
    "snapapp",
  ])("refuses %j as a CORS origin", (origin) => {
    expect(() => spambank({ SPAMBANK_CORS_ORIGINS: origin })).toThrow();
  });
});
