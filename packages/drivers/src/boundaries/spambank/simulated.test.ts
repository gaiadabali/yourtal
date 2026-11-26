import { describe, expect, it } from "vitest";
import { createDrivers } from "../../registry";
import { derivePassword, loginFor } from "./credentials";
import { createSimulatedSpambank } from "./simulated";

const DOMAIN = "yourtal.gaiada.com";

function sim() {
  return createSimulatedSpambank({ domains: [DOMAIN, `spambank.${DOMAIN}`] });
}

describe("the simulated Spambank", () => {
  it("is what an empty environment builds, serving both default domains", async () => {
    const drivers = createDrivers({});
    expect(drivers.spambank.mode).toBe("simulated");
    const domains = (await drivers.spambank.listDomains())._unsafeUnwrap();
    expect(domains.map((domain) => domain.name)).toStrictEqual([DOMAIN, `spambank.${DOMAIN}`]);
  });

  it("takes the domains from the environment", async () => {
    const drivers = createDrivers({
      SPAMBANK_MAIL_DOMAIN: "a.test",
      SPAMBANK_REPLY_DOMAIN: "b.test",
    });
    const names = (await drivers.spambank.listDomains())
      ._unsafeUnwrap()
      .map((domain) => domain.name);
    expect(names).toStrictEqual(["a.test", "b.test"]);
  });

  it("creates an account once, refuses a taken name, and destroys it idempotently", async () => {
    const d = sim();
    const input = { localPart: "geewizduck", domain: DOMAIN, quotaBytes: 1 };
    const created = (await d.createAccount(input))._unsafeUnwrap();
    expect(created.login).toBe(`geewizduck@${DOMAIN}`);
    expect((await d.createAccount(input))._unsafeUnwrapErr().code).toBe("already_exists");
    expect((await d.destroyAccount(created.accountId)).isOk()).toBe(true);
    expect((await d.destroyAccount(created.accountId)).isOk()).toBe(true);
    expect((await d.createAccount(input)).isOk()).toBe(true);
  });

  it("refuses a domain it does not serve", async () => {
    const result = await sim().createAccount({
      localPart: "geewizduck",
      domain: "other.test",
      quotaBytes: 1,
    });
    expect(result._unsafeUnwrapErr().code).toBe("not_found");
  });

  it("creates, lists and revokes app passwords, showing the secret once", async () => {
    const d = sim();
    const { accountId } = (
      await d.createAccount({ localPart: "geewizduck", domain: DOMAIN, quotaBytes: 1 })
    )._unsafeUnwrap();
    const created = (await d.createAppPassword(accountId, "Pixel mail"))._unsafeUnwrap();
    expect(created.secret).toMatch(/^app_[\w-]{20,}$/);
    const listed = (await d.listAppPasswords(accountId))._unsafeUnwrap();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    expect((await d.revokeAppPassword(accountId, created.id)).isOk()).toBe(true);
    expect((await d.listAppPasswords(accountId))._unsafeUnwrap()).toHaveLength(0);
    expect((await d.createAppPassword("nope", "x"))._unsafeUnwrapErr().code).toBe("not_found");
  });

  it("answers 'simulated' to anything that would reach a mailbox", async () => {
    const client = sim().account("geewizduck", DOMAIN);
    expect(client.login).toBe(loginFor("geewizduck", DOMAIN));
    const jmap = await client.jmap({ methodCalls: [] });
    const fetched = await client.fetch("/jmap/session");
    expect(jmap._unsafeUnwrapErr().code).toBe("simulated");
    expect(fetched._unsafeUnwrapErr().code).toBe("simulated");
    expect(jmap._unsafeUnwrapErr().mayHaveSucceeded).toBe(false);
  });
});

describe("derivePassword", () => {
  const KEY = "k".repeat(43);

  it("is stable, login-specific and key-specific", () => {
    const a = derivePassword(KEY, "a@yourtal.gaiada.com");
    expect(derivePassword(KEY, "a@yourtal.gaiada.com")).toBe(a);
    expect(derivePassword(KEY, "b@yourtal.gaiada.com")).not.toBe(a);
    expect(derivePassword("j".repeat(43), "a@yourtal.gaiada.com")).not.toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("matches the documented construction", () => {
    // base64url(HMAC-SHA256(key, "stalwart-account:v1:" + login)), computed independently.
    expect(derivePassword(KEY, "geewizduck@yourtal.gaiada.com")).toBe(
      "bAVXskTuYIPIXDdMCTuU6XOSdYFtXxbTSDiieVXps3I",
    );
  });

  it("refuses a short key", () => {
    expect(() => derivePassword("short", "a@b.test")).toThrow(/32/);
  });
});
