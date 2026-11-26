import { describe, expect, it, vi } from "vitest";
import { LOCAL_PART_PATTERN } from "@yourtal/contracts/spambank/common";
import { createSimulatedSpambank } from "@yourtal/drivers/spambank";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import { loadAppConfig } from "../../../config/app-config";
import { verifyMailToken } from "../mail-token";
import { createFakeStalwart } from "../testing/fake-stalwart";
import { MemoryMailboxStore } from "../testing/memory-mailbox-store";
import { createAppPassword, listAppPasswords, revokeAppPassword } from "./app-passwords";
import { deleteMailbox } from "./delete";
import type { Caller, ManagementDeps } from "./deps";
import { enableMailbox } from "./enable";
import { mintMailSession } from "./session";
import { updateSettings } from "./settings";
import { machineMailboxStatus, mailboxStatus } from "./status";

/**
 * The management use-cases (spambank/BUILD.md section 4.1, 4.2, 4.10, 4.11, 5.1, 5.2) against an
 * in-memory store and either the simulated driver or a fake Stalwart that behaves like the real one
 * (folders, Sieve, identities, app passwords). No database, no network.
 */

const KEY = "k".repeat(43);
const ENV = {
  DATABASE_URL: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
  CHECKPOINT_TOKEN_SECRET: "test-only-checkpoint-signing-key-not-a-real-secret",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "test-only-webhook-secret-encryption-key-not-a-real-secret",
  SNAP_APP_PARTNER_SECRET: "test-only-snap-app-partner-secret-not-a-real-secret",
  SPAMBANK_TOKEN_KEY: KEY,
};

const config = (env: Record<string, string> = {}) => {
  const loaded = loadAppConfig({ ...ENV, ...env }).spambank;
  if (loaded === undefined) throw new Error("no spambank config");
  return loaded;
};

function make(options: { driver?: SpambankDriver; env?: Record<string, string> } = {}) {
  const store = new MemoryMailboxStore();
  const driver = options.driver ?? createSimulatedSpambank({ domains: ["yourtal.gaiada.com"] });
  const log = {
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  };
  const deps: ManagementDeps = {
    store,
    driver,
    config: config(options.env),
    publicOrigin: "https://yourtal.gaiada.com",
    log,
  };
  return { deps, store, driver, log };
}

const ana: Caller = { person: { userId: "user-ana", region: "AU" }, app: "yourtal" };
const budi: Caller = { person: { userId: "user-budi", region: "ID" }, app: "snapapp" };

describe("enableMailbox with the simulated driver", () => {
  it("makes an active mailbox with a name of the right form, in the person's region, via the asking app", async () => {
    const { deps, store } = make();
    const first = await enableMailbox(deps, budi);
    expect(first.created).toBe(true);
    const [localPart, domain] = first.address.split("@");
    expect(domain).toBe("yourtal.gaiada.com");
    expect(localPart).toMatch(LOCAL_PART_PATTERN);
    const row = await store.find("user-budi");
    expect(row).toMatchObject({
      status: "active",
      region: "ID",
      enabledVia: "snapapp",
      localPart,
      domain: "yourtal.gaiada.com",
    });
    expect(row?.stalwartAccountId).not.toBeNull();
  });

  it("returns the same address on a repeat, and does not make a second account", async () => {
    const { deps, store } = make();
    const first = await enableMailbox(deps, ana);
    const again = await enableMailbox(deps, { ...ana, app: "ftr" });
    expect(again).toEqual({ address: first.address, created: false });
    expect(store.rows.size).toBe(1);
    // The app that asked first is the one on record.
    expect((await store.find("user-ana"))?.enabledVia).toBe("yourtal");
  });

  it("gives two calls at once one mailbox", async () => {
    const { deps, store } = make();
    const results = await Promise.all([enableMailbox(deps, ana), enableMailbox(deps, ana)]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0]?.address).toBe(results[1]?.address);
    expect(store.rows.size).toBe(1);
  });

  it("never gives out a retired name, and tries another", async () => {
    const { deps, store } = make();
    // A random source that picks the same pair until that name is retired.
    store.retired.add("zippyduck");
    const { ADJECTIVES, ANIMALS } = await import("../naming/words");
    const sequence = [
      ADJECTIVES.indexOf("zippy"),
      ANIMALS.indexOf("duck"),
      ADJECTIVES.indexOf("plucky"),
      ANIMALS.indexOf("otter"),
    ];
    expect(sequence.every((index) => index >= 0)).toBe(true);
    let call = 0;
    const result = await enableMailbox(
      { ...deps, random: () => sequence[call++ % sequence.length] ?? 0 },
      ana,
    );
    expect(result.address).toBe("pluckyotter@yourtal.gaiada.com");
  });

  it("falls back to a two-digit suffix after ten collisions", async () => {
    const { deps, store } = make();
    const { ADJECTIVES, ANIMALS } = await import("../naming/words");
    store.retired.add("zippyduck");
    // Every draw of the plain form is the retired pair; the suffix draws vary the digits.
    const zippy = ADJECTIVES.indexOf("zippy");
    const duck = ANIMALS.indexOf("duck");
    let call = 0;
    const result = await enableMailbox(
      {
        ...deps,
        random: (max) => {
          call += 1;
          if (max === ADJECTIVES.length) return zippy;
          if (max === ANIMALS.length) return duck;
          return 5; // the suffix: 10 + 5
        },
      },
      ana,
    );
    expect(call).toBeGreaterThan(20);
    expect(result.address).toBe("zippyduck15@yourtal.gaiada.com");
  });
});

describe("enableMailbox with a Stalwart", () => {
  it("creates the account with its quota, then the folders, Sieve rule and identity as the account", async () => {
    const stalwart = createFakeStalwart();
    const { deps, store, log } = make({ driver: stalwart.driver });
    const result = await enableMailbox(deps, ana);
    expect(result.created).toBe(true);

    const row = await store.find("user-ana");
    expect(row?.status).toBe("active");
    const account = stalwart.accounts.get(row?.stalwartAccountId ?? "");
    expect(account?.quotaBytes).toBe(2_147_483_648);
    // The filter's folder is Spam; bulk mail has its own Junk, whose id is stored.
    const byRole = (role: string) => account?.folders.find((folder) => folder.role === role);
    expect(byRole("junk")?.name).toBe("Spam");
    const junk = account?.folders.find((folder) => folder.role === null && folder.name === "Junk");
    expect(junk).toBeDefined();
    expect(row?.junkMailboxId).toBe(junk?.id);
    expect(row?.emailState).toBe("state-0");
    // The Sieve rule is installed, active, and names the real folders.
    expect(account?.sieve).toHaveLength(1);
    expect(account?.sieve[0]?.active).toBe(true);
    expect(account?.sieve[0]?.script).toContain('fileinto "Spam"');
    expect(account?.sieve[0]?.script).toContain('fileinto :create "Junk"');
    expect(account?.sieve[0]?.script).toContain("List-Unsubscribe");
    // The identity is the address.
    expect(account?.identities.map((identity) => identity.email)).toEqual([result.address]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("keeps the filter's folder name when the rename is refused, and files bulk mail in Junk", async () => {
    const stalwart = createFakeStalwart();
    stalwart.knobs.refuseRename = true;
    const { deps, store } = make({ driver: stalwart.driver });
    await enableMailbox(deps, ana);
    const row = await store.find("user-ana");
    const account = stalwart.accounts.get(row?.stalwartAccountId ?? "");
    expect(account?.folders.find((folder) => folder.role === "junk")?.name).toBe("Junk Mail");
    expect(account?.folders.find((folder) => folder.id === row?.junkMailboxId)?.name).toBe("Junk");
    // The rule names the filter's folder as it is.
    expect(account?.sieve[0]?.script).toContain('fileinto "Junk Mail"');
  });

  it("uses Promotions for bulk mail when the filter's folder is called Junk and cannot be renamed", async () => {
    const stalwart = createFakeStalwart();
    stalwart.knobs.refuseRename = true;
    stalwart.knobs.defaultJunkName = "Junk";
    const { deps, store } = make({ driver: stalwart.driver });
    await enableMailbox(deps, ana);
    const row = await store.find("user-ana");
    const account = stalwart.accounts.get(row?.stalwartAccountId ?? "");
    expect(account?.folders.find((folder) => folder.id === row?.junkMailboxId)?.name).toBe(
      "Promotions",
    );
    expect(account?.sieve[0]?.script).toContain('fileinto :create "Promotions"');
  });

  it("is still active when the Sieve rule and the identity cannot be made, and says so in the log", async () => {
    const stalwart = createFakeStalwart();
    stalwart.knobs.failSieve = true;
    stalwart.knobs.failIdentity = true;
    const { deps, store, log } = make({ driver: stalwart.driver });
    const result = await enableMailbox(deps, ana);
    expect(result.created).toBe(true);
    expect((await store.find("user-ana"))?.status).toBe("active");
    expect(log.warn).toHaveBeenCalledTimes(1);
    const message = log.warn.mock.calls[0]?.[0] ?? "";
    expect(message).toContain("sieve rule not installed");
    expect(message).toContain("identity not created");
  });

  it("answers 503 and leaves the row provisioning when Stalwart is down, then finishes on a repeat", async () => {
    const stalwart = createFakeStalwart();
    stalwart.knobs.down = true;
    const { deps, store } = make({ driver: stalwart.driver });
    await expect(enableMailbox(deps, ana)).rejects.toMatchObject({
      status: 503,
      response: { code: "spambank_unavailable" },
    });
    const stuck = await store.find("user-ana");
    expect(stuck?.status).toBe("provisioning");
    expect(stuck?.stalwartAccountId).toBeNull();

    stalwart.knobs.down = false;
    const result = await enableMailbox(deps, ana);
    expect(result.created).toBe(true);
    const done = await store.find("user-ana");
    expect(done?.status).toBe("active");
    // The same name the first attempt reserved.
    expect(done?.localPart).toBe(stuck?.localPart);
    expect(stalwart.accounts.size).toBe(1);
  });

  it("resumes after the account was made but its folders were not ready yet", async () => {
    const stalwart = createFakeStalwart();
    stalwart.knobs.noFoldersYet = true;
    const { deps, store } = make({ driver: stalwart.driver });
    await expect(enableMailbox(deps, ana)).rejects.toMatchObject({ status: 503 });
    const mid = await store.find("user-ana");
    expect(mid?.status).toBe("provisioning");
    expect(mid?.stalwartAccountId).not.toBeNull();

    await enableMailbox(deps, ana);
    expect((await store.find("user-ana"))?.status).toBe("active");
    expect(stalwart.accounts.size).toBe(1);
  });

  it("retires a name Stalwart already has and takes another", async () => {
    const stalwart = createFakeStalwart();
    const { ADJECTIVES, ANIMALS } = await import("../naming/words");
    stalwart.knobs.existingNames.add("zippyduck");
    const sequence = [
      ADJECTIVES.indexOf("zippy"),
      ANIMALS.indexOf("duck"),
      ADJECTIVES.indexOf("plucky"),
      ANIMALS.indexOf("otter"),
    ];
    let call = 0;
    const { deps, store, log } = make({ driver: stalwart.driver });
    const result = await enableMailbox(
      { ...deps, random: () => sequence[call++ % sequence.length] ?? 0 },
      ana,
    );
    expect(result.address).toBe("pluckyotter@yourtal.gaiada.com");
    expect(store.retired.has("zippyduck")).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("already has an account"));
  });

  it("logs an error, not a retry hint, when our derived credential is refused", async () => {
    const stalwart = createFakeStalwart();
    stalwart.knobs.refuseCredential = true;
    const { deps, log } = make({ driver: stalwart.driver });
    await expect(enableMailbox(deps, ana)).rejects.toMatchObject({ status: 503 });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("upstream_auth"));
  });

  it("refuses a mailbox that is being deleted or suspended", async () => {
    const { deps, store } = make();
    await enableMailbox(deps, ana);
    const row = await store.find("user-ana");
    store.rows.set(row?.id ?? "", { ...row!, status: "erasing" });
    await expect(enableMailbox(deps, ana)).rejects.toMatchObject({
      status: 409,
      response: { code: "mailbox_erasing" },
    });
    store.rows.set(row?.id ?? "", { ...row!, status: "suspended" });
    await expect(enableMailbox(deps, ana)).rejects.toMatchObject({
      status: 403,
      response: { code: "not_allowed" },
    });
  });
});

describe("mailboxStatus", () => {
  it("is off before there is a mailbox, on after, with the address", async () => {
    const { deps } = make();
    const subject = { userId: "user-ana", adult: true, onHold: false };
    expect(await mailboxStatus(deps, subject)).toEqual({ available: true, state: "off" });
    const { address } = await enableMailbox(deps, ana);
    expect(await mailboxStatus(deps, subject)).toEqual({
      available: true,
      state: "on",
      address,
      createdAt: "2026-11-28T01:00:00.000Z",
    });
  });

  it("is not_allowed for a teen or an account on hold, without looking at any mailbox", async () => {
    const { deps } = make();
    expect(await mailboxStatus(deps, { userId: "u", adult: false, onHold: false })).toEqual({
      available: true,
      state: "not_allowed",
    });
    expect(await mailboxStatus(deps, { userId: "u", adult: true, onHold: true })).toEqual({
      available: true,
      state: "not_allowed",
    });
  });

  it("says suspended for a suspended mailbox, still with its address", async () => {
    const { deps, store } = make();
    const { address } = await enableMailbox(deps, ana);
    const row = await store.find("user-ana");
    store.rows.set(row?.id ?? "", { ...row!, status: "suspended" });
    expect(
      await mailboxStatus(deps, { userId: "user-ana", adult: true, onHold: false }),
    ).toMatchObject({
      state: "suspended",
      address,
    });
  });

  it("adds the quota from Stalwart when it answers, and leaves it out when it does not", async () => {
    const stalwart = createFakeStalwart({ quotaUsed: 1234 });
    const { deps } = make({ driver: stalwart.driver });
    await enableMailbox(deps, ana);
    const subject = { userId: "user-ana", adult: true, onHold: false };
    expect(await mailboxStatus(deps, subject)).toMatchObject({
      quota: { limitBytes: 2_147_483_648, usedBytes: 1234 },
    });
    stalwart.knobs.down = true;
    const down = await mailboxStatus(deps, subject);
    expect(down.state).toBe("on");
    expect(down.quota).toBeUndefined();
  });

  it("adds the settings for the machine status, with defaults before there is a mailbox", async () => {
    const { deps } = make();
    const subject = { userId: "user-budi", adult: true, onHold: false };
    expect(await machineMailboxStatus(deps, subject)).toEqual({
      available: true,
      state: "off",
      settings: { statementsToSnapApp: false, newMailAlerts: true },
    });
    await enableMailbox(deps, budi);
    await updateSettings(deps, "user-budi", { statementsToSnapApp: true });
    expect((await machineMailboxStatus(deps, subject)).settings).toEqual({
      statementsToSnapApp: true,
      newMailAlerts: true,
    });
  });
});

describe("mintMailSession", () => {
  it("mints a 30-minute token for this mailbox, this person and the asking app", async () => {
    const { deps, store } = make();
    const { address } = await enableMailbox(deps, budi);
    const session = await mintMailSession(deps, budi);
    expect(session.address).toBe(address);
    expect(session.sessionUrl).toBe("https://yourtal.gaiada.com/api/spambank/jmap/session");
    expect(session.helpersBase).toBe("https://yourtal.gaiada.com/api/spambank/mail");
    const row = await store.find("user-budi");
    const verified = verifyMailToken(session.token, KEY);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload).toMatchObject({ m: row?.id, u: "user-budi", a: "snapapp" });
      const lifetime = verified.payload.exp * 1000 - Date.now();
      expect(lifetime).toBeGreaterThan(29 * 60 * 1000);
      expect(lifetime).toBeLessThanOrEqual(30 * 60 * 1000);
    }
    expect(new Date(session.expiresAt).getTime()).toBe(
      (verified.ok ? verified.payload.exp : 0) * 1000,
    );
  });

  it("refuses without a mailbox (409), for a suspended one (403) and without a token key (503)", async () => {
    const { deps, store } = make();
    await expect(mintMailSession(deps, ana)).rejects.toMatchObject({
      status: 409,
      response: { code: "not_enabled" },
    });
    await enableMailbox(deps, ana);
    const row = await store.find("user-ana");
    store.rows.set(row?.id ?? "", { ...row!, status: "suspended" });
    await expect(mintMailSession(deps, ana)).rejects.toMatchObject({ status: 403 });
    store.rows.set(row?.id ?? "", { ...row! });
    const keyless = make();
    const noKey = { ...keyless.deps, config: { ...keyless.deps.config } };
    delete (noKey.config as { tokenKey?: string }).tokenKey;
    await enableMailbox(noKey, ana);
    await expect(mintMailSession(noKey, ana)).rejects.toMatchObject({ status: 503 });
  });
});

describe("app passwords", () => {
  it("creates one with the phone settings, lists it without the secret, and revokes it", async () => {
    const stalwart = createFakeStalwart();
    const { deps } = make({ driver: stalwart.driver });
    const { address } = await enableMailbox(deps, ana);

    const created = await createAppPassword(deps, "user-ana", "Pixel mail");
    expect(created).toMatchObject({
      name: "Pixel mail",
      username: address,
      imap: { host: "mail.yourtal.gaiada.com", port: 993, security: "ssl" },
      smtp: { host: "mail.yourtal.gaiada.com", port: 465, security: "ssl" },
    });
    expect(created.secret).toMatch(/^app_/);

    const listed = await listAppPasswords(deps, "user-ana");
    expect(listed.items.map((item) => item.name)).toEqual(["Pixel mail"]);
    expect(JSON.stringify(listed)).not.toContain(created.secret);

    await revokeAppPassword(deps, "user-ana", created.id);
    expect((await listAppPasswords(deps, "user-ana")).items).toEqual([]);
    // Twice is fine.
    await revokeAppPassword(deps, "user-ana", created.id);
  });

  it("stops at five", async () => {
    const stalwart = createFakeStalwart();
    const { deps } = make({ driver: stalwart.driver });
    await enableMailbox(deps, ana);
    for (let n = 1; n <= 5; n += 1) await createAppPassword(deps, "user-ana", `Phone ${String(n)}`);
    await expect(createAppPassword(deps, "user-ana", "Sixth")).rejects.toMatchObject({
      status: 409,
      response: { code: "app_password_limit" },
    });
  });

  it("holds the limit when two are made at once", async () => {
    const stalwart = createFakeStalwart();
    const { deps } = make({ driver: stalwart.driver });
    await enableMailbox(deps, ana);
    for (let n = 1; n <= 4; n += 1) await createAppPassword(deps, "user-ana", `Phone ${String(n)}`);
    const results = await Promise.allSettled([
      createAppPassword(deps, "user-ana", "Race A"),
      createAppPassword(deps, "user-ana", "Race B"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await listAppPasswords(deps, "user-ana")).items).toHaveLength(5);
  });

  it("cannot reach another person's app password: a revoke acts on this mailbox's account only", async () => {
    const stalwart = createFakeStalwart();
    const { deps } = make({ driver: stalwart.driver });
    await enableMailbox(deps, ana);
    await enableMailbox(deps, budi);
    const anas = await createAppPassword(deps, "user-ana", "Ana's phone");
    await revokeAppPassword(deps, "user-budi", anas.id);
    expect((await listAppPasswords(deps, "user-ana")).items.map((item) => item.name)).toEqual([
      "Ana's phone",
    ]);
  });

  it("needs a mailbox", async () => {
    const { deps } = make();
    await expect(listAppPasswords(deps, "user-ana")).rejects.toMatchObject({ status: 409 });
    await expect(createAppPassword(deps, "user-ana", "x")).rejects.toMatchObject({ status: 409 });
    await expect(revokeAppPassword(deps, "user-ana", "a")).rejects.toMatchObject({ status: 409 });
  });
});

describe("updateSettings", () => {
  it("changes only what was sent, and needs at least one setting and a mailbox", async () => {
    const { deps, store } = make();
    await expect(updateSettings(deps, "user-budi", {})).rejects.toMatchObject({
      status: 400,
      response: { code: "no_setting" },
    });
    await expect(updateSettings(deps, "user-budi", { newMailAlerts: false })).rejects.toMatchObject(
      { status: 409 },
    );
    await enableMailbox(deps, budi);
    await updateSettings(deps, "user-budi", { newMailAlerts: false });
    expect(await store.find("user-budi")).toMatchObject({
      newMailAlerts: false,
      statementsToSnapapp: false,
    });
    await updateSettings(deps, "user-budi", { statementsToSnapApp: true });
    expect(await store.find("user-budi")).toMatchObject({
      newMailAlerts: false,
      statementsToSnapapp: true,
    });
  });
});

describe("deleteMailbox", () => {
  it("destroys the account, removes the row and retires the name for good", async () => {
    const stalwart = createFakeStalwart();
    const { deps, store } = make({ driver: stalwart.driver });
    const { address } = await enableMailbox(deps, ana);
    const localPart = address.split("@")[0] ?? "";
    expect(stalwart.accounts.size).toBe(1);

    await deleteMailbox(deps, "user-ana");
    expect(stalwart.accounts.size).toBe(0);
    expect(await store.find("user-ana")).toBeNull();
    expect(store.retired.has(localPart)).toBe(true);
    // Deleting again: there is nothing to delete.
    await expect(deleteMailbox(deps, "user-ana")).rejects.toMatchObject({ status: 409 });
  });

  it("leaves the row erasing for the sweep when Stalwart cannot be reached", async () => {
    const stalwart = createFakeStalwart();
    const { deps, store, log } = make({ driver: stalwart.driver });
    await enableMailbox(deps, ana);
    stalwart.knobs.down = true;
    await deleteMailbox(deps, "user-ana");
    expect((await store.find("user-ana"))?.status).toBe("erasing");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("the sweep will"));
    expect(stalwart.accounts.size).toBe(1);
  });

  it("a person who deleted can switch on again, with a different name", async () => {
    const { deps } = make();
    const first = await enableMailbox(deps, ana);
    await deleteMailbox(deps, "user-ana");
    const second = await enableMailbox(deps, ana);
    expect(second.created).toBe(true);
    expect(second.address).not.toBe(first.address);
  });
});
