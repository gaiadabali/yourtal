import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmailDriver, selectEmailVendor, type EmailMessage } from "./email";
import { type TestSmtpServer, startTestSmtpServer } from "./email-smtp-test-server";
import { assertDriversConfigured, assertDriversConfiguredForBoot } from "../driver-mode";
import { type SimOutboxEntry, createInMemorySimOutboxStore } from "../sim-outbox";

/**
 * The SMTP vendor beside Resend: how the vendor is chosen, what live email
 * needs, and that the F115 allow-list sits above whichever vendor sends.
 */

const from = "YourTal <no-reply@example.test>";

function msg(to: string, idempotencyKey = `k-${to}`): EmailMessage {
  return {
    idempotencyKey,
    to,
    region: "AU",
    category: "password_reset",
    subject: "Reset your password",
    body: "Reset: https://staging.example.test/reset/abc",
  };
}

function recordingStore() {
  const recorded: SimOutboxEntry[] = [];
  const inner = createInMemorySimOutboxStore();
  return {
    recorded,
    store: {
      record: (entry: SimOutboxEntry) => {
        recorded.push(entry);
        return inner.record(entry);
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vendor selection", () => {
  it("is Resend unless EMAIL_SMTP_URL is set", () => {
    expect(selectEmailVendor({ EMAIL_API_KEY: "k", EMAIL_FROM: from })).toBe("resend");
    expect(selectEmailVendor({ EMAIL_API_KEY: "k", EMAIL_SMTP_URL: "" })).toBe("resend");
    expect(selectEmailVendor({ EMAIL_API_KEY: "k", EMAIL_SMTP_URL: "   " })).toBe("resend");
  });

  it("is SMTP when EMAIL_SMTP_URL is set, with or without a Resend key (SMTP wins)", () => {
    expect(selectEmailVendor({ EMAIL_SMTP_URL: "smtp://relay.example.test:587" })).toBe("smtp");
    expect(
      selectEmailVendor({ EMAIL_API_KEY: "k", EMAIL_SMTP_URL: "smtp://relay.example.test:587" }),
    ).toBe("smtp");
  });

  it("does not call Resend when SMTP is selected", async () => {
    const server = await startTestSmtpServer();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const driver = createEmailDriver("live", {
        EMAIL_API_KEY: "re_not_used",
        EMAIL_FROM: from,
        EMAIL_SMTP_URL: `smtp://127.0.0.1:${String(server.port)}`,
        EMAIL_SMTP_ALLOW_INSECURE: "true",
      });
      const result = await driver.send(msg("person@example.test"));
      expect(result._unsafeUnwrap().route).toBe("live");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(server.recipients).toStrictEqual(["person@example.test"]);
    } finally {
      await server.close();
    }
  });

  it("still uses Resend without EMAIL_SMTP_URL", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "re_1" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const driver = createEmailDriver("live", { EMAIL_API_KEY: "k", EMAIL_FROM: from });
    expect((await driver.send(msg("a@example.test")))._unsafeUnwrap()).toStrictEqual({
      id: "re_1",
      route: "live",
    });
  });
});

describe("live credentials: EMAIL_FROM plus EMAIL_API_KEY or EMAIL_SMTP_URL", () => {
  const live = { EMAIL_DRIVER: "live" };

  it("accepts either vendor's credential", () => {
    for (const vendor of [
      { EMAIL_API_KEY: "k" },
      { EMAIL_SMTP_URL: "smtp://relay.example.test:587" },
      { EMAIL_API_KEY: "k", EMAIL_SMTP_URL: "smtp://relay.example.test:587" },
    ]) {
      expect(assertDriversConfigured({ ...live, ...vendor, EMAIL_FROM: from }).email).toBe("live");
    }
  });

  it("names the missing pieces: the sender, and one of the two vendor credentials", () => {
    const run = (env: Record<string, string>) => {
      try {
        assertDriversConfigured(env);
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    };

    const noVendor = run({ ...live, EMAIL_FROM: from });
    expect(noVendor).toContain("EMAIL_API_KEY or EMAIL_SMTP_URL");
    expect(noVendor).not.toContain("unset: EMAIL_FROM");

    const noFrom = run({ ...live, EMAIL_SMTP_URL: "smtp://relay.example.test:587" });
    expect(noFrom).toContain("EMAIL_FROM");
    expect(noFrom).not.toContain("EMAIL_API_KEY");

    const nothing = run(live);
    expect(nothing).toContain("EMAIL_FROM");
    expect(nothing).toContain("EMAIL_API_KEY or EMAIL_SMTP_URL");
  });

  it("treats a blank EMAIL_SMTP_URL as unset", () => {
    expect(() =>
      assertDriversConfigured({ ...live, EMAIL_FROM: from, EMAIL_SMTP_URL: "  " }),
    ).toThrow(/EMAIL_API_KEY or EMAIL_SMTP_URL/);
  });

  it("keeps the staging rule: live email still needs a non-empty allow-list", () => {
    const env = { ...live, EMAIL_FROM: from, EMAIL_SMTP_URL: "smtp://relay.example.test:587" };
    expect(() => assertDriversConfiguredForBoot(env, "staging")).toThrow(/EMAIL_LIVE_ALLOWLIST/);
    expect(
      assertDriversConfiguredForBoot({ ...env, EMAIL_LIVE_ALLOWLIST: "@example.test" }, "staging")
        .email,
    ).toBe("live");
  });
});

describe("the allow-list sits above the SMTP vendor (F115)", () => {
  let server: TestSmtpServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function stagingDriver(allowlist: string) {
    server = await startTestSmtpServer();
    const { recorded, store } = recordingStore();
    const driver = createEmailDriver(
      "live",
      {
        EMAIL_FROM: from,
        EMAIL_SMTP_URL: `smtp://127.0.0.1:${String(server.port)}`,
        // The test relay has no TLS; dev is the only environment that may say so.
        EMAIL_SMTP_ALLOW_INSECURE: "true",
        EMAIL_LIVE_ALLOWLIST: allowlist,
      },
      undefined,
      store,
    );
    return { driver, recorded };
  }

  it("sends a listed recipient through the relay and records nothing", async () => {
    const { driver, recorded } = await stagingDriver("@gaiada.com,ops@example.org");
    const result = await driver.send(msg("Hansel+yt@gaiada.com"));

    expect(result._unsafeUnwrap().route).toBe("live");
    expect(server?.recipients).toStrictEqual(["Hansel+yt@gaiada.com"]);
    expect(recorded).toStrictEqual([]);
  });

  it("routes an unlisted recipient to platform.sim_outbox and never contacts the relay", async () => {
    const { driver, recorded } = await stagingDriver("@gaiada.com");
    const result = await driver.send(msg("someone@elsewhere.test"));

    expect(result._unsafeUnwrap().route).toBe("simulated");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      boundary: "email",
      recipient: "someone@elsewhere.test",
      category: "password_reset",
    });
    expect(server?.commands).toStrictEqual([]);
    expect(server?.recipients).toStrictEqual([]);
  });

  it("handles a mixed batch: only the listed address reaches the relay", async () => {
    const { driver, recorded } = await stagingDriver("@gaiada.com");
    expect((await driver.send(msg("in@gaiada.com"))).isOk()).toBe(true);
    expect((await driver.send(msg("out@elsewhere.test"))).isOk()).toBe(true);
    expect((await driver.send(msg("also-in@GAIADA.com"))).isOk()).toBe(true);

    // Case-insensitive match; nodemailer lower-cases the domain in the envelope.
    expect(server?.recipients).toStrictEqual(["in@gaiada.com", "also-in@gaiada.com"]);
    expect(recorded.map((entry) => entry.recipient)).toStrictEqual(["out@elsewhere.test"]);
  });

  it("surfaces a relay failure for a listed recipient as the same failure callers handle", async () => {
    server = await startTestSmtpServer({ rejectRcpt: () => "550 5.1.1 no such user" });
    const driver = createEmailDriver(
      "live",
      {
        EMAIL_FROM: from,
        EMAIL_SMTP_URL: `smtp://127.0.0.1:${String(server.port)}`,
        EMAIL_SMTP_ALLOW_INSECURE: "true",
        EMAIL_LIVE_ALLOWLIST: "@gaiada.com",
      },
      undefined,
      createInMemorySimOutboxStore(),
    );
    const failure = (await driver.send(msg("gone@gaiada.com")))._unsafeUnwrapErr();
    expect(failure).toMatchObject({ kind: "declined", boundary: "email" });
  });
});

describe("boot refusals", () => {
  it("createEmailDriver throws when the insecure opt-out meets staging or production", () => {
    for (const APP_ENV of ["staging", "production"]) {
      expect(() =>
        createEmailDriver("live", {
          EMAIL_FROM: from,
          EMAIL_SMTP_URL: "smtp://127.0.0.1:1025",
          EMAIL_SMTP_ALLOW_INSECURE: "true",
          APP_ENV,
        }),
      ).toThrow(/EMAIL_SMTP_ALLOW_INSECURE=true is refused/);
    }
  });

  it("createEmailDriver throws on a malformed or wrong-scheme EMAIL_SMTP_URL", () => {
    expect(() =>
      createEmailDriver("live", { EMAIL_FROM: from, EMAIL_SMTP_URL: "https://relay.example.test" }),
    ).toThrow(/smtp:\/\/ \(STARTTLS\) or smtps:\/\//);
  });

  it("does not build the SMTP driver in simulated mode, whatever the env says", () => {
    const driver = createEmailDriver("simulated", {
      EMAIL_SMTP_URL: "not a url",
      EMAIL_SMTP_ALLOW_INSECURE: "true",
      APP_ENV: "production",
    });
    expect(driver.mode).toBe("simulated");
  });
});
