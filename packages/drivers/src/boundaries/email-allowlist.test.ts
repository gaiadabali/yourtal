import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { createEmailDriver, type EmailDriver, type EmailMessage } from "./email";
import { createAllowListEmail, isAllowListEmpty, parseEmailAllowList } from "./email-allowlist";
import { createInMemorySimOutboxStore } from "../sim-outbox";

const msg = (to: string): EmailMessage => ({
  idempotencyKey: `key-${to}`,
  to,
  region: "AU",
  category: "invitation",
  subject: "Hello",
  body: "Body",
});

async function sendOk(driver: EmailDriver, to: string): Promise<void> {
  expect((await driver.send(msg(to))).isOk()).toBe(true);
}

function setup(raw: string | undefined) {
  const live = {
    mode: "live" as const,
    send: vi.fn(() => Promise.resolve(ok({ id: "m" }))),
  };
  const sim = {
    mode: "simulated" as const,
    send: vi.fn(() => Promise.resolve(ok({ id: "m" }))),
  };
  return { live, sim, driver: createAllowListEmail(live, sim, parseEmailAllowList(raw)) };
}

describe("email allow-list routing", () => {
  it("sends a listed address live and an unlisted one to the simulated driver", async () => {
    const { live, sim, driver } = setup("tester@example.org");
    await sendOk(driver, "tester@example.org");
    await sendOk(driver, "demo@staging.test");
    expect(live.send).toHaveBeenCalledTimes(1);
    expect(sim.send).toHaveBeenCalledTimes(1);
  });

  it("matches @domain entries on the exact domain only", async () => {
    const { live, sim, driver } = setup("@example.org");
    await sendOk(driver, "anyone@example.org");
    await sendOk(driver, "anyone@sub.example.org");
    await sendOk(driver, "anyone@notexample.org");
    expect(live.send).toHaveBeenCalledTimes(1);
    expect(sim.send).toHaveBeenCalledTimes(2);
  });

  it("is case-insensitive and tolerant of spaces and blank items", async () => {
    const { live, sim, driver } = setup(" Tester@Example.ORG , ,@Corp.Example ,");
    await sendOk(driver, "TESTER@example.org");
    await sendOk(driver, "x@CORP.example");
    await sendOk(driver, "other@example.org");
    expect(live.send).toHaveBeenCalledTimes(2);
    expect(sim.send).toHaveBeenCalledTimes(1);
  });

  it("reports the live mode", () => {
    expect(setup("a@example.org").driver.mode).toBe("live");
  });
});

describe("the everyone entry (*)", () => {
  it("sends every recipient live and never touches the simulated driver", async () => {
    const { live, sim, driver } = setup("*");
    await sendOk(driver, "someone@outlook.com");
    await sendOk(driver, "other@staging.test");
    expect(live.send).toHaveBeenCalledTimes(2);
    expect(sim.send).not.toHaveBeenCalled();
  });

  it("tolerates spaces and blank items around the single entry", () => {
    expect(parseEmailAllowList(" * ,").everyone).toBe(true);
    expect(parseEmailAllowList("a@example.org").everyone).toBe(false);
  });

  it("is not an empty list, but an empty one still is", () => {
    expect(isAllowListEmpty(parseEmailAllowList("*"))).toBe(false);
    expect(isAllowListEmpty(parseEmailAllowList(""))).toBe(true);
    expect(isAllowListEmpty(parseEmailAllowList(undefined))).toBe(true);
  });

  it.each(["*,a@example.org", "a@example.org,*", "@example.org,*", "*,*"])(
    "refuses mixing it with other entries (%s)",
    (raw) => {
      expect(() => parseEmailAllowList(raw)).toThrow(/must be the only entry/);
    },
  );

  it("does not treat wildcard-looking entries as everyone", () => {
    for (const raw of ["*.com", "@*"]) {
      expect(() => parseEmailAllowList(raw)).toThrow(/malformed/);
    }
  });

  it("createEmailDriver with * sends an arbitrary recipient through Resend, nothing to the outbox", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "re_9" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const record = vi.fn();
      const driver = createEmailDriver(
        "live",
        {
          EMAIL_API_KEY: "k",
          EMAIL_FROM: "YourTal <no-reply@example.test>",
          EMAIL_LIVE_ALLOWLIST: "*",
        },
        undefined,
        { record },
      );
      const result = await driver.send(msg("someone@outlook.com"));
      expect(result._unsafeUnwrap()).toStrictEqual({ id: "re_9", route: "live" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(record).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("malformed allow-list entries", () => {
  it.each([
    "not-an-address",
    "a@b@example.org",
    "@nodot",
    "Name <a@example.org>",
    "a b@example.org",
  ])("refuses %s without echoing it", (entry) => {
    expect(() => parseEmailAllowList(`ok@example.org,${entry}`)).toThrow(/malformed/);
    expect(() => parseEmailAllowList(`ok@example.org,${entry}`)).not.toThrow(/example\.org/);
  });

  it("never lets an all-malformed list degrade to send-to-everyone", () => {
    expect(() => parseEmailAllowList("oops")).toThrow(/malformed/);
  });
});

describe("createEmailDriver with EMAIL_LIVE_ALLOWLIST", () => {
  const env = (extra: Record<string, string>) => ({
    EMAIL_API_KEY: "re_test_key",
    EMAIL_FROM: "YourTal <no-reply@example.test>",
    ...extra,
  });

  it("records an unlisted recipient in the outbox and does not call Resend", async () => {
    const store = createInMemorySimOutboxStore();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const driver = createEmailDriver(
        "live",
        env({ EMAIL_LIVE_ALLOWLIST: "tester@example.org" }),
        undefined,
        store,
      );
      const result = await driver.send(msg("demo@staging.test"));
      expect(result.isOk()).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([undefined, "", "  "])("sends everyone live when the list is %j", async (raw) => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const driver = createEmailDriver(
        "live",
        env(raw === undefined ? {} : { EMAIL_LIVE_ALLOWLIST: raw }),
        undefined,
        createInMemorySimOutboxStore(),
      );
      await sendOk(driver, "anyone@staging.test");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses to build when an entry is malformed", () => {
    expect(() => createEmailDriver("live", env({ EMAIL_LIVE_ALLOWLIST: "oops" }))).toThrow(
      /malformed/,
    );
  });
});
