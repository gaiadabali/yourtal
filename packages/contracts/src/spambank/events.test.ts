import { describe, expect, it } from "vitest";
import { EVENT_RECEIVERS } from "../oidc/event-receivers";
import {
  SPAMBANK_EVENT_TTL_SECONDS,
  SPAMBANK_QUEUES,
  attachmentFetchRequestSchema,
  snapappReceiver,
  spambankMailEventSchema,
  spambankStatementEventSchema,
  statementAckRequestSchema,
} from "./events";

describe("spambank events", () => {
  it("the mail events go to SnapApp's server client, in dev and staging, and nowhere in production yet", () => {
    expect(snapappReceiver("staging")?.clientId).toBe("snapapp-staging-server");
    expect(snapappReceiver("dev")).toBeDefined();
    expect(snapappReceiver("production")).toBeUndefined();
    // It is a registered receiver, so the sender's endpoint allow-list covers it.
    expect(EVENT_RECEIVERS).toContainEqual(snapappReceiver("staging"));
  });

  it("an alert lasts 15 minutes and a statement offer 24 hours (BUILD.md 5.5)", () => {
    expect(SPAMBANK_EVENT_TTL_SECONDS).toEqual({ mail: 900, statement: 86_400 });
  });

  it("validates the two claims", () => {
    expect(spambankMailEventSchema.safeParse({ unread_inbox: 3 }).success).toBe(true);
    expect(spambankMailEventSchema.safeParse({ unread_inbox: -1 }).success).toBe(false);
    const ok = {
      email_id: "Mabc",
      received_at: "2026-11-28T01:02:03Z",
      attachments: [{ blob_id: "G1", name: "s.pdf", type: "application/pdf", size: 10 }],
    };
    expect(spambankStatementEventSchema.safeParse(ok).success).toBe(true);
    expect(spambankStatementEventSchema.safeParse({ ...ok, attachments: [] }).success).toBe(false);
  });

  it("the machine requests take ids that are safe in a URL and nothing else", () => {
    expect(
      attachmentFetchRequestSchema.safeParse({ sub: "s", emailId: "Mabc", blobId: "G-1_x" })
        .success,
    ).toBe(true);
    for (const bad of ["a/b", "a b", "", "../x", "a?b"]) {
      expect(
        attachmentFetchRequestSchema.safeParse({ sub: "s", emailId: bad, blobId: "G" }).success,
      ).toBe(false);
    }
    expect(
      statementAckRequestSchema.safeParse({ sub: "s", emailId: "M", blobId: "G", outcome: "weird" })
        .success,
    ).toBe(false);
    expect(
      statementAckRequestSchema.safeParse({
        sub: "s",
        emailId: "M",
        blobId: "G",
        outcome: "imported",
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it("queue names are distinct", () => {
    const names = Object.values(SPAMBANK_QUEUES);
    expect(new Set(names).size).toBe(names.length);
  });
});
