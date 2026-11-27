import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";
import type {
  JmapRequest,
  SpambankAccountClient,
  SpambankDriver,
  UpstreamInit,
} from "@yourtal/drivers/spambank";
import { failure } from "../ingest/test-support";
import { createStalwartMailer } from "./mailer";

/** The JMAP the reply account sends (BUILD.md §7 "Auto-reply"), against a scripted Stalwart. */

interface Script {
  readonly requests: JmapRequest[];
  readonly uploads: { path: string; init: UpstreamInit | undefined }[];
  identities: { id: string; email: string }[];
  submission: "ok" | "refused";
  uploadDown?: boolean;
  logins: string[];
}

function driver(script: Script): SpambankDriver {
  const client = (local: string, domain: string): SpambankAccountClient => ({
    login: `${local}@${domain}`,
    jmap(request) {
      script.requests.push(request);
      return Promise.resolve(
        ok({
          methodResponses: request.methodCalls.map(([name, , id]) => {
            switch (name) {
              case "Mailbox/get":
                return [
                  name,
                  {
                    list: [
                      { id: "inbox1", role: "inbox" },
                      { id: "sent1", role: "sent" },
                    ],
                  },
                  id,
                ] as const;
              case "Identity/get":
                return [name, { list: script.identities }, id] as const;
              case "Identity/set":
                script.identities.push({
                  id: "ident-new",
                  email: "reply@spambank.yourtal.gaiada.com",
                });
                return [name, { created: { n: { id: "ident-new" } } }, id] as const;
              case "Email/import":
                return [name, { created: { m: { id: "email-9" } } }, id] as const;
              case "EmailSubmission/set":
                return script.submission === "ok"
                  ? ([name, { created: { s: { id: "sub-1" } } }, id] as const)
                  : ([name, { notCreated: { s: { type: "forbiddenFrom" } } }, id] as const);
              default:
                return ["error", { type: "unknownMethod" }, id] as const;
            }
          }),
        }),
      );
    },
    fetch(path, init) {
      script.logins.push(`${local}@${domain}`);
      if (path === "/jmap/session") {
        return Promise.resolve(
          ok(
            Response.json({
              primaryAccounts: { "urn:ietf:params:jmap:mail": "R1" },
              accounts: { R1: {} },
              uploadUrl: "https://mail.yourtal.gaiada.com/jmap/upload/{accountId}/",
            }),
          ),
        );
      }
      script.uploads.push({ path, init });
      if (script.uploadDown === true) return Promise.resolve(err(failure("unavailable")));
      return Promise.resolve(ok(Response.json({ accountId: "R1", blobId: "blob-7", size: 10 })));
    },
  });
  return { account: client } as unknown as SpambankDriver;
}

function script(over: Partial<Script> = {}): Script {
  return { requests: [], uploads: [], identities: [], submission: "ok", logins: [], ...over };
}

describe("createStalwartMailer", () => {
  it("uploads the raw message, imports it into Sent and submits it with an explicit envelope from reply@", async () => {
    const s = script();
    const mailer = createStalwartMailer(driver(s), "spambank.yourtal.gaiada.com");
    const result = await mailer.send("From: x\r\n\r\nbody", ["news@brand.com.au"]);
    expect(result).toEqual({ ok: true, emailId: "email-9" });
    expect(new Set(s.logins)).toEqual(new Set(["reply@spambank.yourtal.gaiada.com"]));
    expect(s.uploads[0]?.path).toBe("/jmap/upload/R1/");
    expect(s.uploads[0]?.init?.method).toBe("POST");
    expect(s.uploads[0]?.init?.headers).toEqual({ "content-type": "message/rfc822" });
    // No identity yet: one is created for the reply address.
    expect(s.requests.some((r) => r.methodCalls.some(([name]) => name === "Identity/set"))).toBe(
      true,
    );
    const sendCall = s.requests.at(-1);
    expect(sendCall?.using).toEqual([
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
      "urn:ietf:params:jmap:submission",
    ]);
    expect(sendCall?.methodCalls).toEqual([
      [
        "Email/import",
        {
          accountId: "R1",
          emails: {
            m: { blobId: "blob-7", mailboxIds: { sent1: true }, keywords: { $seen: true } },
          },
        },
        "i",
      ],
      [
        "EmailSubmission/set",
        {
          accountId: "R1",
          create: {
            s: {
              identityId: "ident-new",
              emailId: "#m",
              envelope: {
                mailFrom: { email: "reply@spambank.yourtal.gaiada.com" },
                rcptTo: [{ email: "news@brand.com.au" }],
              },
            },
          },
        },
        "s",
      ],
    ]);
  });

  it("reuses an existing identity and reports a refused submission", async () => {
    const s = script({
      identities: [{ id: "ident-1", email: "Reply@spambank.yourtal.gaiada.com" }],
      submission: "refused",
    });
    const mailer = createStalwartMailer(driver(s), "spambank.yourtal.gaiada.com");
    const result = await mailer.send("raw", ["a@b.com"]);
    expect(result).toMatchObject({ ok: false, code: "rejected", nothingSent: true });
    expect(s.requests.some((r) => r.methodCalls.some(([name]) => name === "Identity/set"))).toBe(
      false,
    );
  });

  it("says nothing was sent when the upload fails", async () => {
    const mailer = createStalwartMailer(
      driver(script({ uploadDown: true })),
      "spambank.yourtal.gaiada.com",
    );
    expect(await mailer.send("raw", ["a@b.com"])).toMatchObject({
      ok: false,
      code: "unavailable",
      nothingSent: true,
    });
  });
});
