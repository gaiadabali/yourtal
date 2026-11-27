import { describe, expect, it } from "vitest";
import { JMAP_SENDER_PROPERTIES } from "../classify/jmap-input";
import { newsletter } from "../classify/fixtures/sender-fixtures";
import { folderOf, mailboxFolders, parseMailboxes } from "./folders";
import { INGEST_EMAIL_PROPERTIES, hasKeyword, parseEmail, parseEmails } from "./jmap-email";
import { mailboxList, rawEmail } from "./test-support";

describe("what ingest asks Stalwart for", () => {
  it("includes every sender property of T3, in the :all forms (BUILD.md 7.1)", () => {
    for (const property of JMAP_SENDER_PROPERTIES) {
      expect(INGEST_EMAIL_PROPERTIES).toContain(property);
    }
    expect(INGEST_EMAIL_PROPERTIES).toEqual(
      expect.arrayContaining([
        "id",
        "mailboxIds",
        "keywords",
        "receivedAt",
        "subject",
        "attachments",
      ]),
    );
    // A plain asText header returns only the last instance: never asked for.
    expect(INGEST_EMAIL_PROPERTIES.filter((p) => p.endsWith(":asText"))).toEqual([]);
  });
});

describe("parseEmail", () => {
  it("reads a full Email/get entry", () => {
    const email = parseEmail(
      rawEmail({
        id: "e1",
        in: ["inbox"],
        keywords: ["$seen"],
        subject: "Hello",
        attachments: [{ blobId: "b", name: "a.pdf", type: "application/pdf", size: 10 }],
      }),
    );
    expect(email).toMatchObject({
      id: "e1",
      mailboxIds: { inbox: true },
      subject: "Hello",
      attachments: [{ blobId: "b", name: "a.pdf", type: "application/pdf", size: 10 }],
    });
    expect(email?.receivedAt).toBeInstanceOf(Date);
    expect(email !== null && hasKeyword(email, "$seen")).toBe(true);
    expect(email !== null && hasKeyword(email, "$draft")).toBe(false);
    expect(email?.["header:Authentication-Results:asText:all"]?.length).toBe(1);
  });

  it("drops an entry with no id and keeps the rest", () => {
    expect(parseEmail({})).toBeNull();
    expect(parseEmail(null)).toBeNull();
    expect(parseEmails([{ id: "a" }, null, 7, {}, { id: "b" }]).map((e) => e.id)).toEqual([
      "a",
      "b",
    ]);
    expect(parseEmails("nope")).toEqual([]);
  });

  it("reads a header of the wrong shape as absent, so the classifier fails closed", () => {
    const email = parseEmail({
      ...rawEmail({ id: "w", sender: newsletter() }),
      "header:Authentication-Results:asText:all": "not an array",
      from: "not an array",
      attachments: "nope",
      receivedAt: "not a date",
    });
    expect(email?.["header:Authentication-Results:asText:all"]).toBeUndefined();
    expect(email?.from).toBeNull();
    expect(email?.attachments).toEqual([]);
    expect(email?.receivedAt).toBeNull();
  });
});

describe("folders", () => {
  const folders = mailboxFolders(parseMailboxes(mailboxList(4)), "junk");

  it("finds Inbox, Spam (the junk role), the custom Junk and the unread count", () => {
    expect(folders).toEqual({ inboxId: "inbox", spamId: "spam", junkId: "junk", unreadInbox: 4 });
  });

  it("files a message by where Stalwart put it", () => {
    const at = (...ids: string[]) => {
      const email = parseEmail(rawEmail({ id: "x", in: ids }));
      if (email === null) throw new Error("no id");
      return email;
    };
    expect(folderOf(at("inbox"), folders)).toBe("inbox");
    expect(folderOf(at("spam"), folders)).toBe("spam");
    expect(folderOf(at("junk"), folders)).toBe("junk");
    expect(folderOf(at("sent"), folders)).toBe("other");
    expect(folderOf(at("drafts"), folders)).toBe("other");
    expect(folderOf(at("custom"), folders)).toBe("other");
    expect(folderOf(at("spam", "inbox"), folders)).toBe("spam");
  });

  it("finds Junk by name when its id was not stored, and the fallback name Promotions", () => {
    const list = [
      { id: "i", role: "inbox", name: "Inbox" },
      { id: "j", role: null, name: "Junk" },
    ];
    expect(mailboxFolders(parseMailboxes(list), null).junkId).toBe("j");
    const promos = [
      { id: "p", role: null, name: "Promotions" },
      { id: "s", role: "junk", name: "Junk" },
    ];
    expect(mailboxFolders(parseMailboxes(promos), null)).toMatchObject({
      junkId: "p",
      spamId: "s",
    });
  });

  it("copes with a list that is not one", () => {
    expect(parseMailboxes(undefined)).toEqual([]);
    expect(parseMailboxes([null, 1, {}, { id: "a", unreadEmails: "x" }])).toEqual([
      { id: "a", role: null, name: null, unreadEmails: null },
    ]);
  });
});
