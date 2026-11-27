import { describe, expect, it } from "vitest";
import { MailError } from "@yourtal/mail-engine";
import type { MailSession } from "@yourtal/mail-engine";
import type { ApiResult } from "@/lib/api/api-fetch";
import { fileSize, initialsOf, listDate, mailLocale } from "./mail-format";
import { composeHref, folderHref, messageHref, resolveMailRoute, searchHref } from "./mail-routes";
import { mailErrorCodeFor, sessionFrom } from "./mail-session";
import { mailNavState } from "./spambank-data";
import { linkify, parseAddresses } from "./mail-text";

describe("resolveMailRoute", () => {
  it("maps the URL table, and nothing else", () => {
    expect(resolveMailRoute(undefined)).toStrictEqual({ view: "folder", folder: "inbox" });
    expect(resolveMailRoute(["spam"])).toStrictEqual({ view: "folder", folder: "spam" });
    expect(resolveMailRoute(["message", "abc_1"])).toStrictEqual({ view: "message", id: "abc_1" });
    expect(resolveMailRoute(["search"], { q: "lunch" })).toStrictEqual({
      view: "search",
      q: "lunch",
    });
    expect(resolveMailRoute(["compose"])).toStrictEqual({ view: "compose", mode: "new", id: null });
    expect(resolveMailRoute(["compose"], { mode: "reply", id: "m1" })).toStrictEqual({
      view: "compose",
      mode: "reply",
      id: "m1",
    });
    // A reply with no message, a bad id, an unknown folder or an old settings URL are all 404.
    expect(resolveMailRoute(["compose"], { mode: "reply" })).toBeNull();
    expect(resolveMailRoute(["message", "../x"])).toBeNull();
    expect(resolveMailRoute(["nope"])).toBeNull();
    expect(resolveMailRoute(["settings"])).toBeNull();
    expect(resolveMailRoute(["message", "a", "b"])).toBeNull();
  });

  it("builds hrefs under any base", () => {
    expect(folderHref("/mail", "inbox")).toBe("/mail");
    expect(folderHref("/lab/mail", "junk")).toBe("/lab/mail/junk");
    expect(messageHref("/mail", "a b")).toBe("/mail/message/a%20b");
    expect(searchHref("/mail", "a&b")).toBe("/mail/search?q=a%26b");
    expect(composeHref("/mail", "forward", "m2")).toBe("/mail/compose?mode=forward&id=m2");
  });
});

describe("mail session mapping", () => {
  const session: MailSession = {
    token: "sbm1.x.y",
    expiresAt: "2026-11-28T01:00:00Z",
    sessionUrl: "https://yourtal.gaiada.com/api/spambank/jmap/session",
    helpersBase: "https://yourtal.gaiada.com/api/spambank/mail",
    address: "geewizduck@yourtal.gaiada.com",
  };

  it("hands the engine the minted session", async () => {
    await expect(sessionFrom(() => Promise.resolve({ ok: true, data: session }))).resolves.toBe(
      session,
    );
  });

  it("turns a failed mint into the engine's own error type", async () => {
    const fail = (error: ApiResult<MailSession>) => sessionFrom(() => Promise.resolve(error));
    const http = (status: number, code: string): ApiResult<MailSession> => ({
      ok: false,
      error: { kind: "http", status, code, message: code },
    });
    await expect(fail(http(401, "session_invalid"))).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(fail(http(409, "not_enabled"))).rejects.toMatchObject({ code: "not_enabled" });
    await expect(fail(http(429, "rate_limited"))).rejects.toMatchObject({ code: "rate_limited" });
    await expect(fail(http(503, "spambank_unavailable"))).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(
      fail({ ok: false, error: { kind: "network", message: "offline" } }),
    ).rejects.toBeInstanceOf(MailError);
    expect(mailErrorCodeFor({ kind: "invalid_response", message: "x" })).toBe("unavailable");
    // A thrown Server Action is a network failure to the engine, never an unhandled rejection.
    await expect(sessionFrom(() => Promise.reject(new Error("boom")))).rejects.toMatchObject({
      code: "network",
    });
  });
});

describe("mailNavState (who sees Mail in the shell)", () => {
  const status = (data: object): ApiResult<never> =>
    ({ ok: true, data: { available: true, ...data } }) as unknown as ApiResult<never>;

  it("shows Mail to an adult with or without a mailbox, and runs the badge only when it is on", () => {
    expect(mailNavState(status({ state: "on" }))).toStrictEqual({ on: true });
    expect(mailNavState(status({ state: "off" }))).toStrictEqual({ on: false });
    expect(mailNavState(status({ state: "suspended" }))).toStrictEqual({ on: false });
  });

  it("hides Mail from a teen, when the feature is off, and when the read failed", () => {
    expect(mailNavState(status({ state: "not_allowed" }))).toBeNull();
    expect(mailNavState({ ok: true, data: { available: false } })).toBeNull();
    expect(mailNavState({ ok: false, error: { kind: "network", message: "offline" } })).toBeNull();
  });
});

describe("mail formatting", () => {
  it("formats sizes and dates in the person's language", () => {
    expect(fileSize(1_500_000, "en-AU")).toBe("1.5 MB");
    expect(fileSize(1_500_000, "id-ID")).toBe("1,5 MB");
    expect(fileSize(-1, "en-AU")).toBe("");
    const now = new Date("2026-11-20T12:00:00");
    expect(listDate("2026-11-20T09:15:00", "en-AU", now)).toMatch(/9:15/);
    expect(listDate("2026-11-02T09:15:00", "en-AU", now)).toBe("2 Nov");
    expect(listDate("2026-11-02T09:15:00", "id-ID", now)).toMatch(/^2 Nov/);
    expect(listDate("2024-11-02T09:15:00", "en-AU", now)).toBe("2 Nov 2024");
    expect(listDate("nonsense", "en-AU", now)).toBe("");
    expect(mailLocale("id-ID")).toBe("id-ID");
    expect(mailLocale("fr-FR")).toBe("en-AU");
    expect(initialsOf({ name: "Maria Santos", email: "m@x.com" })).toBe("MS");
    expect(initialsOf(null)).toBe("?");
  });

  it("parses recipients and links only http(s)", () => {
    expect(
      parseAddresses("Maria <maria@example.com>, dev@example.org; nope").invalid,
    ).toStrictEqual(["nope"]);
    const parts = linkify("see https://example.com/a. and javascript:alert(1)");
    expect(parts.filter((p) => p.kind === "link")).toStrictEqual([
      { kind: "link", text: "https://example.com/a", href: "https://example.com/a" },
    ]);
  });
});
