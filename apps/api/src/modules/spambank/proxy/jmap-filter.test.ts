import { describe, expect, it } from "vitest";
import { filterJmapRequest, unsentRecipients } from "./jmap-filter";

const ctx = { accountId: "acctA", address: "geewizduck@yourtal.gaiada.com" };
const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"];

function request(calls: unknown[], using: unknown = USING): unknown {
  return { using, methodCalls: calls };
}

function submission(rcpt: number, extra: Record<string, unknown> = {}): unknown {
  return [
    "EmailSubmission/set",
    {
      accountId: "acctA",
      create: {
        sub: {
          identityId: "i1",
          emailId: "#draft",
          envelope: {
            mailFrom: { email: "GeeWizDuck@yourtal.gaiada.com" },
            rcptTo: Array.from({ length: rcpt }, (_, i) => ({
              email: `r${String(i)}@example.com`,
            })),
          },
          ...extra,
        },
      },
    },
    "s",
  ];
}

describe("filterJmapRequest (BUILD.md §4.3)", () => {
  it("passes an allowed request and keeps only using and methodCalls", () => {
    const result = filterJmapRequest(
      {
        ...(request([["Mailbox/get", { accountId: "acctA", ids: null }, "m"]]) as object),
        createdIds: { x: "y" },
      },
      ctx,
    );
    expect(result).toEqual({
      ok: true,
      body: {
        using: USING,
        methodCalls: [["Mailbox/get", { accountId: "acctA", ids: null }, "m"]],
      },
      submissions: [],
      recipients: 0,
    });
  });

  it.each([
    "x:Account/get",
    "x:AppPassword/set",
    "SieveScript/set",
    "Mailbox/set",
    "Identity/set",
    "Email/import",
    "Email/copy",
    "Email/parse",
    "Blob/get",
    "PushSubscription/set",
    "VacationResponse/set",
    "Principal/get",
  ])("refuses the whole request when it calls %s", (method) => {
    const result = filterJmapRequest(
      request([
        ["Mailbox/get", { accountId: "acctA" }, "a"],
        [method, { accountId: "acctA" }, "b"],
      ]),
      ctx,
    );
    expect(result).toMatchObject({ ok: false, status: 400, code: "method_not_allowed" });
  });

  it("refuses a capability outside the list", () => {
    const result = filterJmapRequest(
      request([["Core/echo", {}, "e"]], [...USING, "urn:stalwart:jmap"]),
      ctx,
    );
    expect(result).toMatchObject({ ok: false, code: "method_not_allowed" });
  });

  it("refuses another account id, and a back-reference to one", () => {
    expect(
      filterJmapRequest(request([["Email/get", { accountId: "acctB", ids: ["m1"] }, "g"]]), ctx),
    ).toMatchObject({
      ok: false,
      status: 403,
      code: "not_allowed",
    });
    expect(
      filterJmapRequest(
        request([
          ["Email/get", { "#accountId": { resultOf: "a", name: "Mailbox/get", path: "/x" } }, "g"],
        ]),
        ctx,
      ),
    ).toMatchObject({ ok: false, code: "invalid_request" });
  });

  it("allows back-references on reads but not on the two write methods", () => {
    const read = filterJmapRequest(
      request([
        ["Email/query", { accountId: "acctA" }, "q"],
        [
          "Email/get",
          { accountId: "acctA", "#ids": { resultOf: "q", name: "Email/query", path: "/ids" } },
          "g",
        ],
      ]),
      ctx,
    );
    expect(read.ok).toBe(true);
    const write = filterJmapRequest(
      request([
        [
          "Email/set",
          { accountId: "acctA", "#create": { resultOf: "q", name: "Email/get", path: "/list" } },
          "e",
        ],
      ]),
      ctx,
    );
    expect(write).toMatchObject({ ok: false, code: "invalid_request" });
  });

  it("lets a created Email carry only the mailbox's own From, no sender and no identity headers", () => {
    const create = (email: Record<string, unknown>) =>
      filterJmapRequest(
        request([["Email/set", { accountId: "acctA", create: { d: email } }, "e"]]),
        ctx,
      );
    expect(
      create({ from: [{ name: "Me", email: "geewizduck@yourtal.gaiada.com" }], subject: "hi" }).ok,
    ).toBe(true);
    expect(create({ subject: "no from given" }).ok).toBe(true);
    expect(create({ from: [{ email: "ceo@bank.example" }] })).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
    expect(
      create({ from: [{ email: "geewizduck@yourtal.gaiada.com" }, { email: "x@example.com" }] }),
    ).toMatchObject({ ok: false });
    expect(create({ sender: [{ email: "x@example.com" }] })).toMatchObject({ ok: false });
    expect(create({ "header:From:asAddresses": [{ email: "ceo@bank.example" }] })).toMatchObject({
      ok: false,
    });
    expect(
      create({
        bodyStructure: {
          type: "text/plain",
          headers: [{ name: "From", value: "ceo@bank.example" }],
        },
      }),
    ).toMatchObject({ ok: false });
    expect(create({ "header:List-Unsubscribe": "<mailto:x@example.com>" }).ok).toBe(true);
  });

  it("requires an explicit envelope from the mailbox's own address", () => {
    expect(filterJmapRequest(request([submission(1, { envelope: undefined })]), ctx)).toMatchObject(
      {
        ok: false,
        status: 400,
        code: "envelope_required",
      },
    );
    const spoofed = filterJmapRequest(
      request([
        submission(1, {
          envelope: { mailFrom: { email: "x@example.com" }, rcptTo: [{ email: "a@b.example" }] },
        }),
      ]),
      ctx,
    );
    expect(spoofed).toMatchObject({ ok: false, code: "envelope_required" });
  });

  it("allows 10 recipients and refuses 11", () => {
    expect(filterJmapRequest(request([submission(10)]), ctx)).toMatchObject({
      ok: true,
      recipients: 10,
    });
    expect(filterJmapRequest(request([submission(11)]), ctx)).toMatchObject({
      ok: false,
      status: 400,
      code: "too_many_recipients",
    });
  });

  it("refuses malformed requests", () => {
    for (const body of [
      null,
      "x",
      { using: USING },
      request([]),
      request([["Core/echo", {}]]),
      request([["Core/echo", [], "c"]]),
    ]) {
      expect(filterJmapRequest(body, ctx)).toMatchObject({ ok: false, status: 400 });
    }
  });
});

describe("unsentRecipients", () => {
  const filtered = filterJmapRequest(request([submission(3)]), ctx);
  if (!filtered.ok) throw new Error("fixture");

  it("gives back nothing when the submission was created", () => {
    const response = {
      methodResponses: [["EmailSubmission/set", { created: { sub: { id: "S1" } } }, "s"]],
    };
    expect(unsentRecipients(filtered.submissions, response)).toBe(0);
  });

  it("gives back a refused submission, a method error and an unreadable answer", () => {
    expect(
      unsentRecipients(filtered.submissions, {
        methodResponses: [
          ["EmailSubmission/set", { notCreated: { sub: { type: "forbiddenFrom" } } }, "s"],
        ],
      }),
    ).toBe(3);
    expect(
      unsentRecipients(filtered.submissions, {
        methodResponses: [["error", { type: "serverFail" }, "s"]],
      }),
    ).toBe(3);
    expect(unsentRecipients(filtered.submissions, "not json")).toBe(3);
  });
});
